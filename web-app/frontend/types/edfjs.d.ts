declare module "edfjs" {
    export class EDF {
        constructor();

        read_buffer(buffer: ArrayBuffer): void;

        // EDF metadata
        getHeader(): unknown;

        // Signal information
        getSignals(): unknown;

        [key: string]: any;
    }

    const edfjs: {
        EDF: typeof EDF;
    };

    export default edfjs;
}