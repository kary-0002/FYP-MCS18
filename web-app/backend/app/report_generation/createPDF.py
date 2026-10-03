############################################
#  This module is used to create a PDF file with EEG analysis results
#  The PDF file contains figures of EEG epochs, PSDs, topomaps, spectrogram, 
#   and left/right power ratio
#  The EEG analysis results are also included in the PDF file
#  The PDF file is saved in the destination folder
#  The EEG jpg files are deleted after the PDF file is created
#  If ai_report_text is not None, the AI report by LLMs is included in the PDF file
############################################
import matplotlib.pyplot as plt
from matplotlib import font_manager
from scipy import signal
from PIL import Image
from datetime import datetime 
import numpy as np
import os
import mne

mne.viz.set_browser_backend('matplotlib')

class writePDF:    
    def __init__(self, filename, rawData, epochs, psds, results, dest_folder, sr, chNames, ai_report_text=None, report_data=None, deleteJpg=False):
        self.fileName=filename
        
        if dest_folder[-1] not in ['\\', '/']:
            if '/' in dest_folder:
                dest_folder+='/'
            else:
                dest_folder += '\\'

        if not os.path.exists(dest_folder):
            try:
                os.makedirs(dest_folder)
            except Exception as e:
                print ('Error: ', e)
        self.dest_folder=dest_folder  
        self.results=results

        self.drawEpochs(epochs)
        self.drawPsds(psds)
        self.drawLeftRightDiff(results['LR_alpha_ratio'], results['LR_theta_ratio'], results['LR_delta_ratio'], results['alphaDiffChannels'])
        self.drawFreqPower(psds)
        self.plotTopMaps(epochs)
        self.plotSpectrogram(rawData, sr, chNames)
        self.ai_report_text=ai_report_text
        self.report_data = report_data or {}
        self.deleteJpg=deleteJpg
        
        self.savePDF(results)
        if deleteJpg:
            for jpg in ['eeg0.jpg','eeg1.jpg', 'eeg2.jpg', 'eeg3.jpg', 'eeg4.jpg', 'eeg5.jpg']:
                jpgFile= self.dest_folder+jpg
                if os.path.exists(jpgFile):
                    try: 
                        os.remove(jpgFile)
                    except Exception as e:
                        print ('Error: ', e)
                        continue


    def addImageFit(self, pdf, image_path, x, y, max_width, max_height):
        with Image.open(image_path) as img:
            width_px, height_px = img.size
        aspect_ratio = width_px / height_px
        width = max_width
        height = width / aspect_ratio
        if height > max_height:
            height = max_height
            width = height * aspect_ratio
        x = x + (max_width - width) / 2
        pdf.image(image_path, x=x, y=y, w=width, h=height)


    def renderSeizureTableHeader(self, pdf, fontName, body_size):
        widths = [10, 32, 32, 26, 43, 43]
        headings = ["#", "Start", "End", "Duration", "Mean Probability", "Max Probability"]
        pdf.ln(2)
        pdf.set_x(12)
        pdf.set_font(fontName, style="B", size=body_size - 2)
        for width, heading in zip(widths, headings):
            pdf.cell(width, 6, text=heading, border=1, align="C")
        pdf.ln(6)


    def renderSeizureCandidateRow(self, pdf, fontName, text, body_size):
        widths = [10, 32, 32, 26, 43, 43]
        parts = [part.strip().rstrip(".") for part in text.split(";")]
        candidate_part = parts[0]
        candidate_label, times = candidate_part.split(":", 1)
        candidate_number = candidate_label.replace("Candidate", "").strip()
        start, end = [value.strip() for value in times.split(" - ", 1)]
        values = {
            "duration": "",
            "mean model probability": "",
            "maximum model probability": ""
        }
        for part in parts[1:]:
            if ":" not in part:
                continue
            key, value = part.split(":", 1)
            values[key.strip()] = value.strip()
        row = [
            candidate_number, start, end,
            values["duration"],
            values["mean model probability"],
            values["maximum model probability"]
        ]
        if pdf.get_y() + 6 > pdf.h - pdf.b_margin:
            pdf.add_page()
            pdf.set_font(fontName, style="B", size=body_size + 1)
            pdf.multi_cell(0, 6, "Automated Seizure Detection (continued)")
            self.renderSeizureTableHeader(pdf, fontName, body_size)
        pdf.set_x(12)
        pdf.set_font(fontName, size=body_size - 2)
        for width, value in zip(widths, row):
            pdf.cell(width, 6, text=value, border=1, align="C")
        pdf.ln(6)


    def formatMetadataDate(self, value, include_time=False):
        if value in (None, ""):
            return None
        if isinstance(value, str):
            try:
                value = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return value
        if hasattr(value, "strftime"):
            if include_time:
                return value.strftime("%d %b %Y, %H:%M:%S")
            return value.strftime("%d %b %Y")
        return str(value)


    def formatDuration(self, seconds):
        if seconds is None:
            return None
        total_seconds = int(round(float(seconds)))
        hours = total_seconds // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


    def renderSimpleMetadataTable(self, pdf, fontName, title, rows):
        rows = [(label, str(value)) for label, value in rows if value not in (None, "")]
        if not rows:
            return
        pdf.ln(1)
        pdf.set_x(12)
        pdf.set_font(fontName, style="B", size=12)
        pdf.cell(186, 6, text=title, ln=1)
        label_width = 42
        value_width = 144
        line_height = 4
        min_row_height = 6
        padding = 1
        for label, value in rows:
            # Work out how many lines each cell needs.
            pdf.set_font(fontName, style="B", size=9)
            label_lines = self.wrapText(pdf, label, label_width - 4)
            pdf.set_font(fontName, size=9)
            value_lines = self.wrapText(pdf, value, value_width - 4)
            line_count = max(len(label_lines), len(value_lines))
            row_height = max(min_row_height, line_count * line_height + 2 * padding)
            # Keep the whole row together if we're near the bottom of a page.
            if pdf.get_y() + row_height > pdf.page_break_trigger:
                pdf.add_page()
            x = 12
            y = pdf.get_y()
            # Draw full-height borders first.
            pdf.rect(x, y, label_width, row_height)
            pdf.rect(x + label_width, y, value_width, row_height)
            # Label cell.
            pdf.set_xy(x + 2, y + padding)
            pdf.set_font(fontName, style="B", size=9)
            pdf.multi_cell(label_width - 4, line_height, label, border=0, align="L")
            # Value cell.
            pdf.set_xy(x + label_width + 2, y + padding)
            pdf.set_font(fontName, size=9)
            pdf.multi_cell(value_width - 4, line_height, value, border=0, align="L")
            # Move cursor to the next table row.
            pdf.set_xy(x, y + row_height)


    def renderTestRecordingTable(self, pdf, fontName, test_rows, recording_rows):
        test_rows = [(label, str(value)) for label, value in test_rows if value not in (None, "")]
        recording_rows = [(label, str(value)) for label, value in recording_rows if value not in (None, "")]
        if not test_rows and not recording_rows:
            return
        pdf.ln(1)
        pdf.set_x(12)
        pdf.set_font(fontName, style="B", size=12)
        pdf.cell(186, 6, text="Test & Recording Information", ln=1)
        # Two independent vertical lists.
        half_width = 93
        left_label = 28
        left_value = 65
        right_label = 32
        right_value = 61
        row_height = 6
        row_count = max(len(test_rows), len(recording_rows))
        for index in range(row_count):
            test_item = (test_rows[index] if index < len(test_rows) else ("", ""))
            recording_item = (recording_rows[index] if index < len(recording_rows) else ("", ""))
            pdf.set_x(12)
            pdf.set_font(fontName, style="B", size=9)
            pdf.cell(left_label, row_height, text=test_item[0], border=1)
            pdf.set_font(fontName, size=9)
            pdf.cell(left_value, row_height, text=test_item[1], border=1)
            pdf.set_font(fontName, style="B", size=9)
            pdf.cell(right_label, row_height, text=recording_item[0], border=1)
            pdf.set_font(fontName, size=9)
            pdf.cell(right_value, row_height, text=recording_item[1], border=1, ln=1)


    def renderMetadata(self, pdf, fontName):
        metadata = self.report_data.get("recording_metadata") or {}
        nicolet = metadata.get("nicolet") or {}
        patient = nicolet.get("patient") or {}
        study = (nicolet.get("study", {}).get("mapped", {}) if nicolet else {})
        test = (nicolet.get("test", {}).get("mapped", {}) if nicolet else {})
        name_parts = [patient.get("firstName"), patient.get("middleName"), patient.get("lastName")]
        patient_name = " ".join(
            part.strip() for part in name_parts
            if isinstance(part, str) and part.strip()
            and part.strip() != "." and part.strip().lower() != "null"
        )
        patient_rows = []
        if patient_name:
            patient_rows.append(("Patient Name", patient_name))
        if patient.get("altID"):
            patient_rows.append(("Patient ID", patient.get("altID")))
        if metadata.get("patient_id"):
            patient_rows.append(("EDF Patient ID" if nicolet else "Patient ID", metadata.get("patient_id")))
        patient_rows.extend([
            ("Date of Birth", self.formatMetadataDate(patient.get("DOB"))),
            ("Hand Dominance", patient.get("dominance")),
            ("Patient Notes", patient.get("notes"))
        ])
        self.renderSimpleMetadataTable(pdf, fontName, "Patient Information", patient_rows)
        pdf.ln(3)

        recording_rows = [
            ("Test Created", self.formatMetadataDate(study.get("creation_date"), include_time=True)),
            ("Recording Start", self.formatMetadataDate(metadata.get("recording_start"), include_time=True)),
            ("Duration", self.formatDuration(metadata.get("duration_seconds"))),
            ("Sampling Rate", (f"{metadata['sampling_rate_hz']:g} Hz" if metadata.get("sampling_rate_hz") is not None else None)),
            ("Channels", metadata.get("channel_count"))
        ]
        if nicolet:
            test_rows = [
                ("Test ID", study.get("test_id")),
                ("Type", study.get("type")),
                ("Patient State", study.get("patient_state")),
                ("Requested By", study.get("requested_by")),
                ("Technologist", test.get("technologist")),
                ("Recording Site", test.get("recording_site"))
            ]
            self.renderTestRecordingTable(pdf, fontName, test_rows, recording_rows)
        else:
            self.renderSimpleMetadataTable(pdf, fontName, "Recording Information", recording_rows)


    def renderFigureInterpretation(self, pdf, fontName, overview, recording_summary):
        pdf.ln(2)
        pdf.set_font(fontName, size=9.5)
        pdf.set_x(12)
        pdf.multi_cell(186, 4.5, overview, align="J")
        pdf.ln(1.5)
        pdf.set_x(12)
        pdf.multi_cell(186, 4.5, recording_summary, align="J")
        pdf.ln(3)


    def renderBackgroundMetricsInterpretation(
        self, pdf, fontName, removeEpochsRatio, amplitudes, right_slow_ratio, left_slow_ratio, total_slow_ratio,
        right_beta_ratio, left_beta_ratio, total_beta_ratio, right_AP_difference, left_AP_difference,
        AP_difference, right_backgroud_frequency, left_backgroud_frequency, bad_channels
    ):
        pdf.ln(6)
        pdf.set_x(12)
        pdf.set_font(fontName, style="B", size=11)
        pdf.cell(186, 6, text="Interpretive Notes", ln=1)
        pdf.set_font(fontName, size=9.5)
        overview = (
            "The table summarises numerical features used by the automated background-analysis pipeline. "
            "The drop-epochs ratio indicates the proportion of candidate EEG epochs excluded during automated "
            "preprocessing. Band amplitudes summarise estimated delta, theta, alpha and beta activity. "
            "Slow-wave and beta-wave ratios describe the relative contribution of those frequency components "
            "across the right hemisphere, left hemisphere and recording overall. The anterior-posterior "
            "gradient metric describes the pipeline's calculated front-to-back power relationship. Posterior "
            "background peak values represent the estimated dominant frequencies used in the background assessment, "
            "while the background-difference value quantifies the difference between the left and right estimates. "
            "Channels listed as bad electrodes were flagged during automated preprocessing and may contain signal-quality limitations."
        )
        pdf.set_x(12)
        pdf.multi_cell(186, 4.5, overview, align="J")
        pdf.ln(2)
        f_diff = abs(left_backgroud_frequency - right_backgroud_frequency)
        channel_text = (", ".join(bad_channels) if bad_channels else "none")
        recording_summary = (
            f"For this recording, {removeEpochsRatio}% of candidate epochs were excluded "
            f"during automated preprocessing. Estimated band amplitudes were "
            f"{amplitudes['delta']:.1f} μV for delta, "
            f"{amplitudes['theta']:.1f} μV for theta, "
            f"{amplitudes['alpha']:.1f} μV for alpha and "
            f"{amplitudes['beta']:.1f} μV for beta. "
            f"The total slow-wave ratio was {total_slow_ratio}%, compared with "
            f"{right_slow_ratio}% on the right and {left_slow_ratio}% on the left. "
            f"The total beta-wave ratio was {total_beta_ratio}%, and the overall "
            f"anterior-posterior gradient metric was {AP_difference}%. "
            f"Posterior background peaks were estimated at {right_backgroud_frequency} Hz on the right and "
            f"{left_backgroud_frequency} Hz on the left, giving an interhemispheric difference of {f_diff:.2f} Hz. "
            f"Channels flagged by automated preprocessing: {channel_text}."
        )
        pdf.set_x(12)
        pdf.multi_cell(186, 4.5, recording_summary, align="J")
        pdf.ln(2)
        threshold_note = (
            "Red values indicate measurements that cross the screening thresholds used by this implementation. "
            "These thresholds are used to support automated feature classification and should not be "
            "interpreted as independent clinical diagnostic cut-offs."
        )
        pdf.set_x(12)
        pdf.multi_cell(186, 4.5, threshold_note, align="J")


    def wrapText(self, pdf, text, max_width):
        words = text.split()
        lines = []
        current = ""
        for word in words:
            candidate = word if not current else f"{current} {word}"
            if pdf.get_string_width(candidate) <= max_width:
                current = candidate
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)
        return lines


    def renderBullet(self, pdf, fontName, text, body_size=11, indent=12, style=""):
        line_height = body_size * 0.45
        bullet_width = 6
        text_x = indent + bullet_width
        text_width = 198 - text_x
        pdf.set_font(fontName, style=style, size=body_size)
        lines = self.wrapText(pdf, text, text_width)
        total_height = max(1, len(lines)) * line_height
        # Keep the whole bullet together rather than leaving the bullet
        # or first line stranded at the bottom of a page.
        if pdf.will_page_break(total_height):
            pdf.add_page()
        if not lines:
            return
        start_y = pdf.get_y()
        pdf.set_x(indent)
        pdf.cell(bullet_width, line_height, text="\u2022", align="L")
        pdf.set_xy(text_x, start_y)
        pdf.cell(text_width, line_height, text=lines[0], ln=1)
        for wrapped_line in lines[1:]:
            pdf.set_x(text_x)
            pdf.cell(text_width, line_height, text=wrapped_line, ln=1)


    def renderReportText(self, pdf, fontName, body_size):
        line_height = body_size * 0.45
        current_section = None
        seizure_table_started = False
        annotation_started = False
        for raw_line in self.ai_report_text.splitlines():
            line = raw_line.strip()
            if not line:
                pdf.ln(line_height * 0.4)
                continue

            # Section heading: === EEG Findings ===
            if line.startswith("===") and line.endswith("==="):
                heading = line.strip("=").strip()
                if heading in {"Impression", "Suggested Next Steps"}:
                    min_space = 35 if heading == "Impression" else 30
                    if pdf.page_break_trigger - pdf.get_y() < min_space:
                        pdf.add_page()
                current_section = heading
                pdf.ln(1)
                pdf.set_font(fontName, style="B", size=body_size + 1)
                pdf.multi_cell(0, line_height + 1, heading)
                pdf.set_font(fontName, size=body_size)
                continue

            if current_section == "Automated Seizure Detection" and line.startswith("- Candidate "):
                text = line[2:].strip()
                if not seizure_table_started:
                    self.renderSeizureTableHeader(pdf, fontName, body_size)
                    seizure_table_started = True
                self.renderSeizureCandidateRow(pdf, fontName, text, body_size)
                continue

            # Restore normal report formatting
            if seizure_table_started:
                pdf.ln(2)
                pdf.set_font(fontName, size=body_size)
                seizure_table_started = False

            if current_section == "Reviewer Annotations" and line.startswith("- Annotation "):
                if annotation_started:
                    pdf.ln(2)
                self.renderBullet(pdf, fontName, line[2:].strip(), body_size=body_size, indent=12, style="B")
                annotation_started = True
                continue

            # Nested bullet
            if raw_line.startswith("  - ") or raw_line.startswith("  * "):
                text = raw_line.strip()[2:].strip()
                self.renderBullet(pdf, fontName, text, body_size=body_size, indent=18)
                continue

            # Normal bullet from either deterministic or Gemini output
            if line.startswith("- ") or line.startswith("* "):
                text = line[2:].strip()
                self.renderBullet(pdf, fontName, text, body_size=body_size, indent=12)
                continue

            if current_section == "Reviewer Annotations" and raw_line.startswith("  "):
                text = raw_line.strip()
                pdf.set_x(18)
                pdf.set_font(fontName, size=body_size)
                pdf.multi_cell(180, body_size * 0.45, text, align="L")
                continue

            # Normal prose
            pdf.set_x(12)
            pdf.multi_cell(186, line_height, line, align="J")
            

    def savePDF(self, results):     
        print ('savePDF')
        removeEpochsRatio=results['removeEpochsRatio']
        AP_difference=results['AP_difference']
        right_AP_difference=results['right_AP_difference']
        left_AP_difference=results['left_AP_difference']
        left_backgroud_frequency=results['left_backgroud_frequency']
        right_backgroud_frequency=results['right_backgroud_frequency']
        right_slow_ratio=results['right_slow_ratio']
        left_slow_ratio=results['left_slow_ratio']
        total_slow_ratio=results['total_slow_ratio']
        left_beta_ratio=results['left_beta_ratio']
        right_beta_ratio=results['right_beta_ratio']
        total_beta_ratio=results['total_beta_ratio']
        bad_channels=results['bad_channels']
        amplitudes=results['amplitudes']
        f_diff = abs(float(left_backgroud_frequency) - float(right_backgroud_frequency))
        bad_channel_text = (", ".join(bad_channels) if bad_channels else "none")

        # create PDF with figList and removeEpochsRatio, slowRatio
        from fpdf import FPDF
        class ReportPDF(FPDF):
            def footer(self):
                font_name = getattr(self, "report_font_name", "Helvetica")
                self.set_y(-13)
                self.set_draw_color(190, 190, 190)
                self.set_line_width(0.2)
                self.line(12, self.get_y(), 198, self.get_y())
                self.ln(2)
                self.set_x(12)
                self.set_font(font_name, size=8)
                self.set_text_color(105, 105, 105)
                self.cell(150, 4, text="Automated EEG Analysis Prototype | Findings require clinical review and are not intended as a standalone diagnosis.", align="L")
                self.cell(36, 4, text=f"Page {self.page_no()}", align="R")
                self.set_text_color(0, 0, 0)

        pdf = ReportPDF(orientation="P", unit="mm", format="A4")
        pdf.set_margins(left=8, top=10, right=8)
        
        line_height = 7.5
        available_fonts = {font.name for font in font_manager.fontManager.ttflist}
        if "Times New Roman" in available_fonts:
            font_family = "Times New Roman"
        elif "Liberation Serif" in available_fonts:
            font_family = "Liberation Serif"
        else:
            font_family = "DejaVu Serif"
        fontName = "ReportSerif"
        fontPath = font_manager.findfont(font_manager.FontProperties(family=font_family))
        boldFontPath = font_manager.findfont(font_manager.FontProperties(family=font_family, weight="bold"))
        pdf.add_font(fontName, fname=fontPath)
        pdf.add_font(fontName, style="B", fname=boldFontPath)
        pdf.report_font_name = fontName

        if self.ai_report_text:
            pdf.add_page()
            pdf.set_font(fontName, style='B', size=18)
            pdf.cell(0, 9, text='Automated EEG Analysis Report', ln=1, align='C')
            pdf.set_draw_color(0, 0, 0)
            pdf.set_line_width(0.4)
            pdf.line(10, pdf.get_y() + 1, 200, pdf.get_y() + 1)
            pdf.ln(4)
            self.renderMetadata(pdf, fontName)
            pdf.ln(2)
            self.renderReportText(pdf, fontName, body_size=11)

        pdf.add_page()
        pdf.set_font(fontName, style="B", size=18)
        pdf.cell(0, 9, text="Automated Background Analysis", ln=1, align="C")
        pdf.set_font(fontName, size=11)
        pdf.cell(0, 6, text=self.fileName, ln=1, align="C")
        pdf.ln(6)

        table_width = 140
        table_x = (pdf.w - table_width) / 2
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Drop epochs ratio', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if removeEpochsRatio>=75:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(46, line_height, text=' '+str(removeEpochsRatio)+'%', ln=0, align='L', border=1)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(24, line_height, text=' ', ln=1, align='L', border=1)

        # 振幅
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Amplitudes(μV)', ln=0, align='L', border=1)
        pdf.cell(17, line_height, text='α: '+str(round(amplitudes['alpha'], 1)), ln=0, align='L', border=1)
        pdf.cell(17, line_height, text='β: '+str(round(amplitudes['beta'], 1)), ln=0, align='L', border=1)
        pdf.cell(17, line_height, text='θ: '+str(round(amplitudes['theta'], 1)), ln=0, align='L', border=1)
        pdf.cell(19, line_height, text='δ: '+str(round(amplitudes['delta'], 1)), ln=1, align='L', border=1)
        
        # 慢波比例
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Slow wave ratio', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Right', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Left', ln=0, align='L', border=1)
        pdf.cell(24, line_height, text=' Total', ln=1, align='L', border=1)

        #  左右、總慢波比例
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' <60', ln=0, align='R', border=1)
        color= (0, 0, 0)
        if right_slow_ratio>=60:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(right_slow_ratio)+'%', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if left_slow_ratio>=60:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(left_slow_ratio)+'%', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if total_slow_ratio>=60:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(24, line_height, text=' '+str(total_slow_ratio)+'%', ln=1, align='L', border=1)
        pdf.set_text_color(0, 0, 0)

        # 快波比例
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Beta wave ratio', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Right', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Left', ln=0, align='L', border=1)
        pdf.cell(24, line_height, text=' Total', ln=1, align='L', border=1)

        #  左右、
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' <30', ln=0, align='R', border=1)
        color= (0, 0, 0)
        if right_beta_ratio>=30:
            color=(255, 0, 0)
        pdf.set_text_color(*color)

        pdf.cell(23, line_height, text=' '+str(right_beta_ratio)+'%', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if left_beta_ratio>=30:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(left_beta_ratio)+'%', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if total_beta_ratio>=30:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(24, line_height, text=' '+str(total_beta_ratio)+'%', ln=1, align='L', border=1)
        pdf.set_text_color(0, 0, 0)

        # 前後gradient
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' AP gradient', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Right', ln=0, align='L', border=1)
        pdf.cell(23, line_height, text=' Left', ln=0, align='L', border=1)
        pdf.cell(24, line_height, text=' Total', ln=1, align='L', border=1)

        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' <40', ln=0, align='R', border=1)
        color= (0, 0, 0)
        if right_AP_difference>=40:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(right_AP_difference)+'%', ln=0, align='L', border=1)
        pdf.set_text_color(0, 0, 0)
        color= (0, 0, 0)
        if left_AP_difference>=40:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(left_AP_difference)+'%', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if AP_difference>=40:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(24, line_height, text=' '+str(AP_difference)+'%', ln=1, align='L', border=1)
        pdf.set_text_color(0, 0, 0)

        # O1, O2 主頻率
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Background peak', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if left_backgroud_frequency<8:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(23, line_height, text=' '+str(right_backgroud_frequency), ln=0, align='L', border=1)
        color= (0, 0, 0)
        if right_backgroud_frequency<8:
            color=(255, 0, 0)
        pdf.cell(23, line_height, text=' '+str(left_backgroud_frequency), ln=0, align='L', border=1)
        pdf.set_text_color((0, 0, 0))
        pdf.cell(24, line_height, text=' >=8', ln=1, align='L', border=1)

        # O1, O2 主頻率差異
        fDiff=left_backgroud_frequency-right_backgroud_frequency
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Background difference', ln=0, align='L', border=1)
        color= (0, 0, 0)
        if abs(fDiff)>0.5:
            color=(255, 0, 0)
        pdf.set_text_color(*color)
        pdf.cell(46, line_height, text=' '+str(round(abs(fDiff), 2)), ln=0, align='L', border=1)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(24, line_height, text='<=0.5', ln=1, align='L', border=1)

        # 左右channel差異，列出異常channel
        # for ab in abnormals:
        #     st=','.join(abnormals[ab]) 
        #     # pdf.cell(200, line_height, text=ab+': '+st, ln=1, align='C')
        #     pdf.cell(30, line_height, text='', ln=0, align='L')
        #     pdf.cell(70, line_height, text=' '+ab, ln=0, align='L', border=1)
        #     pdf.set_text_color(255, 0, 0)
        #     pdf.cell(70, line_height, text=' '+st, ln=1, align='L', border=1)
        #     pdf.set_text_color(0, 0, 0)
        
        # bad channels
        pdf.set_x(table_x)
        pdf.cell(70, line_height, text=' Bad electrodes', ln=0, align='L', border=1)
        pdf.set_text_color(255, 0, 0)
        pdf.cell(70, line_height, text=' '+','.join(bad_channels), ln=1, align='L', border=1)   
        pdf.set_text_color(0, 0, 0)
        self.renderBackgroundMetricsInterpretation(
            pdf, fontName, removeEpochsRatio, amplitudes, right_slow_ratio, left_slow_ratio, total_slow_ratio,
            right_beta_ratio, left_beta_ratio, total_beta_ratio, right_AP_difference, left_AP_difference,
            AP_difference, right_backgroud_frequency, left_backgroud_frequency, bad_channels
        )


        pdf.set_font(fontName, style="B", size=18)
        pdf.add_page(orientation = 'P')
        pdf.cell(0, line_height, text='EEG Spectral Analysis', ln=1, align='C')
        overview = (
            "This page combines three complementary spectral views of the EEG. The topographic maps "
            "show the spatial distribution of delta (1-4 Hz), theta (4-8 Hz), alpha (8-13 Hz), and "
            "beta (13-30 Hz) activity across the scalp, including relative band power and absolute "
            "power-density views. The left/right normalized-power plot compares homologous channel pairs "
            "in the delta, theta and alpha bands; values closer to zero indicate more similar power between "
            "the paired channels, while larger absolute differences indicate greater spectral asymmetry. "
            "The dashed ±0.5 lines provide the reference limits used by this graph. The posterior power "
            "spectral density plot shows frequency-specific power for T5/T6, O1/O2, and P3/P4, and provides "
            "a more detailed view of dominant posterior frequency content."
        )
        recording_summary = (
            f"For this recording, the automated analysis estimated posterior background peaks of "
            f"{right_backgroud_frequency} Hz on the right and {left_backgroud_frequency} Hz on the left, "
            f"giving a difference of {f_diff:.2f} Hz. The automated summary also reported a total "
            f"slow-wave ratio of {total_slow_ratio}%, a total beta-wave ratio of {total_beta_ratio}%, "
            f"and an anterior-posterior gradient metric of {AP_difference}%. Channels flagged during "
            f"automated preprocessing: {bad_channel_text}. These numerical results provide context for the "
            f"spatial and spectral patterns shown here; individual colour, peak or side-to-side differences "
            f"should not be interpreted independently as clinical findings."
        )
        self.renderFigureInterpretation(pdf, fontName, overview, recording_summary)
        jpgFile = self.dest_folder+'eeg0.jpg'
        self.addImageFit(pdf, jpgFile, 10, pdf.get_y() + 5, 190, 100)
        # 左右channel差異
        jpgFile=self.dest_folder+'eeg1.jpg'
        self.addImageFit(pdf, jpgFile, 10, pdf.get_y() + 108, 190, 38)
        # O1, O2 主頻率
        jpgFile=self.dest_folder+'eeg2.jpg'
        self.addImageFit(pdf, jpgFile, 10, pdf.get_y() + 152, 190, 38)


        # 新增頁面
        pdf.add_page(orientation='P')
        pdf.set_font(fontName, style="B", size=18)
        pdf.cell(0, 9, text="EEG Epochs (4s each)", ln=1, align="C")
        overview = (
            "This figure displays representative 4-second multichannel EEG epochs from the data supplied "
            "to the background-analysis pipeline after preprocessing. Each trace corresponds to an EEG "
            "channel and allows the underlying waveform morphology, amplitude, and residual signal quality "
            "to be inspected directly. The alternating trace colours are used only to improve visual separation "
            "between channels and do not represent abnormality classifications, seizure detections or reviewer "
            "annotations. This view therefore complements the numerical background metrics by showing examples "
            "of the signal from which those measurements were derived."
        )
        recording_summary = (
            f"For this recording, {removeEpochsRatio}% of candidate epochs were excluded by the automated "
            f"preprocessing procedure before background analysis. Channels flagged during preprocessing: "
            f"{bad_channel_text}. The epochs displayed here should therefore be interpreted as representative "
            f"preprocessed signal segments rather than as a complete view of the recording. Their appearance "
            f"alone does not establish the presence or absence of a seizure or other clinically significant event."
        )
        self.renderFigureInterpretation(pdf, fontName, overview, recording_summary)
        jpgFile = self.dest_folder + 'eeg5.jpg'
        self.addImageFit(pdf, jpgFile, x=10, y=pdf.get_y() + 2, max_width=190, max_height=269 - pdf.get_y())

        # 第二頁
        pdf.add_page(orientation='P')
        pdf.set_font(fontName, style="B", size=18)
        pdf.cell(0, 9, text='Regional Power Spectral Density', ln=1, align='C')
        overview = (
            "This figure compares power spectral density between corresponding left- and right-sided EEG "
            "channels across occipital, temporal, parietal, central, and frontal regions. The horizontal axis "
            "represents frequency, while the plotted power values show how signal energy is distributed across "
            "the analysed frequency range. Spectral peaks mark frequencies at which relatively greater power is "
            "present. Comparing the paired O1/O2, T5/T6, T3/T4, P3/P4, C3/C4, F7/F8, F3/F4, and Fp1/Fp2 spectra "
            "provides visual context for regional frequency content and possible side-to-side differences."
        )
        recording_summary = (
            f"For this recording, the automated background analysis estimated posterior background peaks of "
            f"{right_backgroud_frequency} Hz on the right and {left_backgroud_frequency} Hz on the left, "
            f"corresponding to an absolute difference of {f_diff:.2f} Hz. The automated analysis also reported "
            f"a total slow-wave ratio of {total_slow_ratio}%. Channels flagged during preprocessing: "
            f"{bad_channel_text}. The regional spectra provide a visual representation with which these summary "
            f"measurements can be compared, but apparent spectral differences should be reviewed alongside the "
            f"raw EEG rather than treated as independent diagnostic findings."
        )
        self.renderFigureInterpretation(pdf, fontName, overview, recording_summary)
        jpgFile = self.dest_folder + 'eeg3.jpg'
        self.addImageFit(pdf, jpgFile, x=10, y=pdf.get_y() + 2, max_width=190, max_height=269 - pdf.get_y())

        # 第三頁
        pdf.add_page(orientation='P')
        pdf.set_font(fontName, style="B", size=18)
        pdf.cell(0, 9, text='Spectrogram', ln=1, align='C')
        overview = (
            "The spectrogram provides a time-frequency representation of the EEG for each displayed channel. "
            "Time is shown horizontally, frequency vertically from approximately 1 to 30 Hz, and colour "
            "represents spectral power in dB/Hz. The analysis uses overlapping 2-second windows, allowing "
            "changes in frequency content to be followed across the recording rather than summarised into a "
            "single whole-recording spectrum. The horizontal 8 Hz reference line provides visual context "
            "for the lower boundary of the conventional alpha-frequency range."
        )
        recording_summary = (
            f"For this recording, the automated background analysis estimated posterior background frequencies "
            f"of {right_backgroud_frequency} Hz on the right and {left_backgroud_frequency} Hz on the left and "
            f"reported a total slow-wave ratio of {total_slow_ratio}%. The spectrogram can be used to inspect "
            f"how frequency content changes over time and to visually correlate temporal changes with automated "
            f"seizure candidates or reviewer annotations where available. The current pipeline does not generate "
            f"a separate spectrogram-specific abnormality classification, so patterns visible on this page "
            f"require visual review rather than being treated as additional automated findings."
        )
        self.renderFigureInterpretation(pdf, fontName, overview, recording_summary)
        jpgFile = self.dest_folder + 'eeg4.jpg'
        self.addImageFit(pdf, jpgFile, x=10, y=pdf.get_y() + 2, max_width=190, max_height=269 - pdf.get_y())

        outFile=self.dest_folder+self.fileName.split('.')[0]+'.pdf'
        pdf.output(outFile)
        print ('Successfully generate pdf file: ', outFile)
        
    
    def drawPsds(self, psds):   
        picks=['T5', 'T6', 'O1', 'O2', 'P3', 'P4']
        powers, freqs=psds.copy().get_data(picks=picks,  return_freqs=True, fmin=1, fmax=25)
        powers=powers*1e12
        # print(freqs)
        # print ('p.shape: ', powers.shape, 'f.shape: ', freqs.shape) #p.shape:  (6, 18) f.shape:  (18,)
        powers=10*np.log10(powers)
        
        plt.figure(figsize=(12, 3))
        plt.xlabel('Frequency [Hz]')
        plt.ylabel('Power [dB/Hz]')
        plt.title('Posterior Dominant Frequency')
        legends=[]
            
        for i in range(powers.shape[0]):
            ch_name=picks[i]
            psd=powers[i, :]
            max=np.max(psd)
            # peaks, _ = find_peaks(psd, height=0.3*max, prominence=0.3)
            # plt.plot(freqs[peaks], psd[peaks], "x" if i%2==0 else "o")
            # legends.append(ch_name+' peaks')
            # for peak in peaks:
                
            #     plt.text(freqs[peak], psd[peak], picks[i], fontsize=12)

            # print ('ch_name: ', ch_name)
            if ch_name == 'P3':
                color='blue'
            elif ch_name == 'P4':
                color='green'
            elif i%2==0:
                color='black'
            else:
                color='red'

            lineW=0.6

            if ch_name in ['O1', 'O2']:
                plt.plot(freqs, powers[i], label=ch_name, color=color, linewidth=lineW, alpha=1)
            elif ch_name in ['P3', 'P4']:
                plt.plot(freqs,  powers[i], label=ch_name, alpha=0.7, color=color, linewidth=lineW)
            else:
                plt.plot(freqs,  powers[i], label=ch_name, linestyle='--', alpha=0.5, color=color, linewidth=lineW)
            legends.append(ch_name)
        # draw x grid
        plt.grid(axis='x', linestyle='--', alpha=0.5)
        plt.xticks(np.arange(3, 25,1))
        plt.title('Posterior Power Spectral Density', fontsize=18)
            
        # plt.show()
        plt.legend(legends)
        plt.tight_layout()
        jpgFile=self.dest_folder+'eeg2.jpg'
        # plt.savefig(jpgFile, dpi=300)
        plt.savefig(jpgFile, dpi=300, bbox_inches='tight')
        plt.close()
    

    def drawEpochs(self, epochs):
        # 畫出epochs的圖
            epochs_sub=epochs.copy()
            # color list [black, black, darkred,
            ch_num=len(epochs_sub.ch_names)
            # colorList=['black' for i in range(ch_num) if i%2==0 else 'darkred']
            # colorList=['black', 'black', 'darkred', 'darkred'.....
            colorList=['black' if i%2==0 else 'darkred' for i in range(ch_num)]
            epoch_num=len (epochs_sub)
            colorList=[colorList]*epoch_num
                        
            fig=epochs_sub.plot(scalings={'eeg': 60e-6, 'misc':50e-6, 'seeg':50e-6}, block=False, n_epochs=6, show=False,
                        overview_mode='hidden', show_scrollbars=False, epoch_colors=colorList)
            
            # fig.grab().save('eeg5.jpg')
            jpgFile=self.dest_folder+'eeg5.jpg'
            fig.savefig(jpgFile, dpi=300)
            plt.close()


    def drawLeftRightDiff(self, diffAlpha, diffTheta, diffDelta, chNames):
        fig, ax = plt.subplots(figsize=(12,3))

        # range -1-1
        ax.set_ylim([-1, 1])

        # plot bar in separate positions
        
        aplha=0.9
        ax.bar(np.arange(len(diffDelta)), diffDelta, width=0.2, label='1-4Hz', alpha=aplha, color='salmon')
        ax.bar(np.arange(len(diffTheta)) + 0.2, diffTheta, width=0.2, label='4-8Hz', alpha=aplha, color='peachpuff')
        ax.bar(np.arange(len(diffAlpha)) + 0.4, diffAlpha, width=0.2, label='8-12Hz', alpha=aplha, color='mediumseagreen')


        ax.set_xticks(np.arange(len(diffDelta)) + 0.2)
        ax.set_xticklabels(chNames)
        ax.set_ylabel('Normalized power difference')

        # plot y=0 green, y=0.5 red y=-0.5 red
        ax.axhline(y=0, color='green', linestyle='--')
        ax.axhline(y=0.5, color='red', linestyle='--')
        ax.axhline(y=-0.5, color='red', linestyle='--')

        ax.legend()
        # plt.title('Left/Right power ratio, left is positive', fontsize=18)
        plt.title('Left/Right Normalized Power Difference', fontsize=18)

        # Append the figure to the list
        jpgFile=self.dest_folder+'eeg1.jpg'
        plt.savefig(jpgFile, dpi=300)
        plt.close()

    def drawFreqPower(self, psds):
        # Create a 20x25 figure
        fig = plt.figure(figsize=(20, 25))
        gs = fig.add_gridspec(4, 4)    

        # psds.plot_topomap(
        #     bands = [(1,4,'Delta'), (4,8,'Theta'), (8,13,'Alpha'), (13,30,'Beta')], show=True, 
        #     normalize=True , axes=[fig.add_subplot(gs[0, i]) for i in range(4) ], cmap='coolwarm',)
        # psds:  <Power Spectrum (from Epochs, multitaper method) | 277 epochs × 21 channels × 15 freqs, 1.0-8.0 Hz>

        
        # psds=raw_epochs.compute_psd(fmin=1, fmax=30, verbose=False, method='welch', n_fft=64, n_overlap=16, n_per_seg=64)
        def plot_psds(L1, L2, axes):
            dataL1=psds.copy().pick(L1).get_data()*1e12
            dataL2=psds.copy().pick(L2).get_data()*1e12
            freqs=psds.freqs

            axes.plot(freqs, 10*np.log10(dataL1.mean(axis=0)), color='maroon', alpha=0.7)
            axes.plot(freqs, 10*np.log10(dataL2.mean(axis=0)), color='midnightblue', alpha=0.7)
            # plot vertical grid
            axes.grid(axis='x', linestyle='--', alpha=0.5)
            

            # psds.copy().pick(chs).plot( show=True, axes=axes, color='maroon', spatial_colors=False,)
            # psds.copy().pick(L2).plot( show=True,  axes=axes, color='midnightblue', spatial_colors=False, )
            axes.set_title('Power Spectrum (PSD){}'.format(' - '.join(L1+L2)))
            axes.set_xticks(range(0, 30, 1))  # Set x-axis ticks at 1 Hz intervals
            # legend concat L1 and L2, L1 
            axes.legend(['{}'.format(ch_name) for ch_name in L1+L2], labelcolor=['maroon' if ch_name in L1 else 'midnightblue' for ch_name in L1+L2])


        #plot in axes row 1 , 
        plot_psds(['O1'], ['O2'], fig.add_subplot(gs[0, 0:2]))
        plot_psds(['T5'], ['T6'], fig.add_subplot(gs[0, 2:4]))
        plot_psds(['T3'], ['T4'], fig.add_subplot(gs[1,0:2]))
        plot_psds(['P3'], ['P4'], fig.add_subplot(gs[1,2:4]))
        plot_psds(['C3'], ['C4'], fig.add_subplot(gs[2,0:2]))
        plot_psds(['F7'], ['F8'], fig.add_subplot(gs[2,2:4]))
        plot_psds(['F3'], ['F4'], fig.add_subplot(gs[3,0:2]))
        plot_psds(['Fp1'], ['Fp2'], fig.add_subplot(gs[3,2:4]))
        plt.tight_layout()
        jpgFile=self.dest_folder+'eeg3.jpg'
        plt.savefig(jpgFile, dpi=72, bbox_inches='tight')
        plt.close()

    
    def plotSpectrogram(self, data, sr, picks_chs):
        f, t, Sxx = signal.spectrogram(data, fs=sr, nperseg=sr*2, noverlap=sr, nfft=sr*4)
        freq_range_mask = (f >= 1) & (f <= 30)
        f = f[freq_range_mask]
        Sxx = Sxx[:, freq_range_mask, :]

        # subplot 1 row 2 column, figsize=(20, 5)    
        plt.figure(figsize=(20, 30))
        rows=len(picks_chs)//2+1  
        
        for idx in range(len(picks_chs)):
            plt.subplot(rows, 2, idx+1)       

            plt.pcolormesh(t, f, 10 * np.log10(Sxx[idx]), cmap='coolwarm', vmin=-25, vmax=25)
            ch_name=picks_chs[idx]
            # plt.ylabel(ch_name+'-Hz')
            plt.title(ch_name)
            plt.ylabel('Frequency (Hz)')
            plt.xlabel('Time [sec]')
            # plt pink line at y=8
            plt.axhline(y=8, color='darkred', linestyle='--')
            plt.colorbar(label='Power [dB/Hz]')
        plt.tight_layout()
        jpgFile=self.dest_folder+'eeg4.jpg'
        plt.savefig(jpgFile, dpi=72, bbox_inches='tight')
        plt.close()

    def plotTopMaps(self, epochs):
        
        # Define your power spectrum data and channel names
        # Replace this with your actual power spectrum array and channel names

        # plot 4 columns
        fig, ax = plt.subplots(3,4, figsize=(12,9))
        fig.suptitle("Power Spectrum Topomaps", fontsize=18)
        # grid line
        fig.subplots_adjust( hspace=0.5)
        fv = 0.2
        L = 1*fv
        y = np.linspace(-L/2, L/2, 200)
        for i in range(4):
            for j in range(3):
                x=plot_egg_contour( ax[j,i], y, L, 0.9*fv, 0.005*fv, 0.77*fv, show=False)
                
        # y= np.concatenate((y, y))
        # x= np.concatenate((-x, x))
            


        axes=[ax[0,0], ax[0,1], ax[0,2], ax[0,3]]

        power_spectrum=epochs.copy().compute_psd(method='welch', fmin=1, fmax=30, n_jobs=4)
        # outlines outlines‘head’ | dict | None
        # The outlines to be drawn. If ‘head’, the default head scheme will be drawn. If dict, each key refers to a tuple of x and y positions, the values in ‘mask_pos’ will serve as image mask. Alternatively, a matplotlib patch object can be passed for advanced masking options, either directly or as a function that returns patches (required for multi-axis plots). If None, nothing will be drawn. Defaults to ‘head’.
        # custom outline
        outlines_dict = dict(
                        head=([],[]),
                        mask_pos=(x, y),
                        clip_radius=[0.09,0.1]

                    )
        power_spectrum.plot_topomap( normalize=True, bands = [(1,4,'Delta'), (4,8,'Theta'), (8,13,'Alpha'), (13,30,'Beta')], border=0,
                axes=axes,  contours=2, cmap=('turbo',True), outlines=outlines_dict, vlim=(0,1), sensors=False, colorbar=False)

        axes=[ax[1,0], ax[1,1], ax[1,2], ax[1,3]]
        power_spectrum.plot_topomap( normalize=False, bands = [(1,4,'Delta'), (4,8,'Theta'), (8,13,'Alpha'), (13,30,'Beta')], 
                dB=True, axes=axes,  contours=1, cmap='turbo', outlines=outlines_dict, sensors=False, vlim='joint', colorbar=True)


        axes=[ax[2,0], ax[2,1], ax[2,2], ax[2,3]]
        power_spectrum.plot_topomap( normalize=False, bands = [(1,4,'Delta'), (4,8,'Theta'), (8,13,'Alpha'), (13,30,'Beta')],  
            dB=True, axes=axes,  contours=1, cmap='turbo', outlines=outlines_dict, sensors=False, colorbar=False)
        # rowTitle=[r'Normalized PSD (μV${^2}$/Hz)', 'Absolute PSD(dB)', 'Band absolute PSD(dB)']
        rowTitle = ['Relative Band Power', 'Absolute PSD (dB/Hz) - Shared Scale', 'Absolute PSD (dB/Hz) - Individual Scale']
        for i in range(3):

            for j in range(4):
                # draw border
                if j==0:
                    ax[i,j].text(-max(x), 1.4*max(y), rowTitle[i], color='black', fontsize=16)
                ax[i,j].axis('off')
                ax[i,j].plot(x, y, 'k', alpha=0.9, linewidth=0.5)
                ax[i,j].plot(-x, y, 'k', alpha=0.9, linewidth=0.5)
                # write text "Left" in the left lower corner
                ax[i,j].text(-max(x), min(y), 'Left O', color='black')  

        # ax[0,0].text(3*max(x), 1.8*max(y),'Power spectrum density', fontsize=20, color='black')
        jpgFile=self.dest_folder+'eeg0.jpg'
        fig.savefig(jpgFile, dpi=300)
        plt.close()
        


# set font chinese
plt.rc('font')#, family='Arial Unicode MS')
def yegg(x, L, B, w, D):
    """
    The "universal" formula for an egg, from Narushin et al., "Egg and math:
    introducing a universal formula for egg shape", *Ann. N.Y. Acad. Sci.*,
    **1505**, 169 (2021).
    x should vary between -L/2 and L/2 where L is the length of the egg; B
    is the maximum breadth of the egg; w is the distance between two vertical
    lines corresponding to the maximum breadth and y-axis (with the origin
    taken to be at the centre of the egg); D is the egg diameter at the point
    a distance L/4 from the pointed end.

    """

    fac1 = np.sqrt(5.5*L**2 + 11*L*w + 4*w**2)
    fac2 = np.sqrt(L**2 + 2*w*L + 4*w**2)
    fac3 = np.sqrt(3)*B*L
    fac4 = L**2 + 8*w*x + 4*w**2
    return (B/2) * np.sqrt((L**2 -4*x**2) / fac4) * (
        1 - (fac1 * (fac3 - 2*D*fac2) / (fac3 * (fac1 - 2*fac2)))
     * (1 - np.sqrt(L*fac4 / (2*(L - 2*w)*x**2
                    + (L**2 + 8*L*w - 4*w**2)*x + 2*L*w**2 + L**2*w + L**3))))

def plot_egg_contour(axes, y, L, B, w, D, show=True):

    x = yegg(y, L, B, w, D)
    if show:
        axes.plot(x, y, 'k')
        axes.plot(-x, y, 'k')
        axes.axis('equal')
    return x
    # plt.axis('off')






