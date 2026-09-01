import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const assets = {
  "": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "index.html": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "app.js": { file: "app.js", contentType: "text/javascript; charset=utf-8" },
  "styles.css": { file: "styles.css", contentType: "text/css; charset=utf-8" },
  "theme.css": { file: "theme.css", contentType: "text/css; charset=utf-8" },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset?: string[] }> },
) {
  const { asset = [] } = await params;
  const assetName = asset.join("/") as keyof typeof assets;
  const selectedAsset = assets[assetName];

  if (!selectedAsset) {
    return new NextResponse("Not found", { status: 404 });
  }

  const sourcePath = path.resolve(
    process.cwd(),
    "../../Prawin's Part",
    selectedAsset.file,
  );
  const contents = await readFile(sourcePath);
  const body = selectedAsset.file === "index.html"
    ? contents
        .toString("utf8")
        .replace('href="styles.css"', 'href="/neuroscope/styles.css"')
        .replace('href="theme.css"', 'href="/neuroscope/theme.css"')
        .replace('src="app.js"', 'src="/neuroscope/app.js"')
    : contents;

  return new NextResponse(body, {
    headers: {
      "Content-Type": selectedAsset.contentType,
      "Cache-Control": "no-cache",
    },
  });
}
