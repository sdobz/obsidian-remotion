import ts from "typescript";

/**
 * Player configuration options compatible with Remotion's Player component.
 * All fields are optional and use sane defaults when not specified.
 */
export interface PreviewPlayerOptions {
  durationInFrames?: number;
  fps?: number;
  compositionWidth?: number;
  compositionHeight?: number;
  controls?: boolean;
  loop?: boolean;
  autoPlay?: boolean;
  [key: string]: any;
}

/**
 * Semantic location of a preview() call in source code.
 * Includes line/column position, length, and optional player configuration.
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
  /** Parsed options from second argument, if present */
  options?: PreviewPlayerOptions;
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

  function parseObjectLiteral(
    node: ts.ObjectLiteralExpression,
  ): PreviewPlayerOptions | undefined {
    const options: any = {};
    let hasAnyProperty = false;

    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop) && prop.name) {
        hasAnyProperty = true;
        const keyText = prop.name.getText(sourceFile);
        const valueNode = prop.initializer;

        if (ts.isNumericLiteral(valueNode)) {
          options[keyText] = parseInt(valueNode.text, 10);
        } else if (ts.isStringLiteral(valueNode)) {
          options[keyText] = valueNode.text;
        } else if (valueNode.kind === ts.SyntaxKind.TrueKeyword) {
          options[keyText] = true;
        } else if (valueNode.kind === ts.SyntaxKind.FalseKeyword) {
          options[keyText] = false;
        }
      }
    }

    return hasAnyProperty ? options : undefined;
  }

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

        // Try to parse options from second argument
        let options: PreviewPlayerOptions | undefined;
        if (callExpr.arguments.length > 1) {
          const secondArg = callExpr.arguments[1];
          if (ts.isObjectLiteralExpression(secondArg)) {
            options = parseObjectLiteral(secondArg);
          }
        }

        locations.push({
          line: lineAndChar.line + 1, // Convert to 1-based
          column: lineAndChar.character,
          pos: start,
          length,
          text,
          options,
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
