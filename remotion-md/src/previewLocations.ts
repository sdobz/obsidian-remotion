import ts from "typescript";

/**
 * Semantic location of a preview() call in source code.
 * Includes line/column position and length for scroll synchronization.
 */
export interface PreviewSpan {
  /** Line number in source (1-based) */
  line: number;
  /** Column position in line (0-based) */
  column: number;
  /** Character offset in entire file (0-based) */
  pos: number;
  /** Length of the preview() call */
  length: number;
  /** Full text of the preview call */
  text: string;
}

/**
 * @deprecated Use PreviewSpan instead
 */
export type PreviewCallLocation = PreviewSpan;

/**
 * Extract locations of all preview() function calls from TypeScript AST.
 * Used to anchor scroll positions in the preview pane.
 *
 * @param sourceFile TypeScript SourceFile to analyze
 * @returns Array of semantic locations in order of appearance
 */
export function extractPreviewCallLocations(
  sourceFile: ts.SourceFile,
): PreviewSpan[] {
  const locations: PreviewSpan[] = [];

  function visit(node: ts.Node) {
    // Look for call expressions like preview(...)
    if (ts.isCallExpression(node)) {
      const callExpr = node as ts.CallExpression;

      // Check if the function being called is the identifier 'preview'
      if (
        ts.isIdentifier(callExpr.expression) &&
        callExpr.expression.text === "preview"
      ) {
        const start = callExpr.getStart(sourceFile);
        const end = callExpr.getEnd();
        const length = end - start;
        const text = sourceFile.text.substring(start, end);

        // Get line and column
        const lineAndChar = sourceFile.getLineAndCharacterOfPosition(start);

        locations.push({
          line: lineAndChar.line + 1, // Convert to 1-based
          column: lineAndChar.character,
          pos: start,
          length,
          text,
        });
      }
    }

    // Recursively visit all child nodes
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return locations;
}

/**
 * Detect preview() misuse, such as passing JSX instead of a component reference.
 */
