export declare function generateStubContent(): string;
export declare function generateFlowContent(entryPoint: {
    x: number;
    y: number;
}): string;
export declare function modifyEntryPoint(content: string, newX: number, newY: number): string;
export declare function getEntryPoint(content: string): {
    x: number;
    y: number;
} | null;
//# sourceMappingURL=content.d.ts.map