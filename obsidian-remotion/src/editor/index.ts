import type { MarkdownView } from "obsidian";
import { EditorView, Decoration } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import type { MarkdownDiagnostic, PreviewSpan } from "remotion-md";
import type { Band } from "obsidian-remotion-runtime";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { hoverTooltip, type Tooltip } from "@codemirror/view";
import type ts from "typescript";

/**
 * Editor Integration Module
 *
 * Centralizes all CodeMirror interaction logic including:
 * - EditorView access from Obsidian MarkdownView
 * - Diagnostic decorations and visualization
 * - Editor state management
 * - Viewport measurements and coordinate conversion
 */

// ============================================================================
// EditorView Access
// ============================================================================

/**
 * Centralized accessor for CodeMirror EditorView from Obsidian MarkdownView.
 * Eliminates duplicate type casting across domains.
 */
export function getEditorView(activeView: MarkdownView): EditorView | null {
  const cm = (activeView.editor as any).cm;
  if (!cm || typeof cm.dispatch !== "function") {
    return null;
  }
  return cm as EditorView;
}

// ============================================================================
// Diagnostic Decorations
// ============================================================================

const setDiagnosticsEffect = StateEffect.define<MarkdownDiagnostic[]>();

function buildDecorations(
  state: EditorView["state"],
  diagnostics: MarkdownDiagnostic[],
) {
  const ranges = [] as Array<ReturnType<Decoration["range"]>>;

  for (const diagnostic of diagnostics) {
    const lineNumber = diagnostic.line;
    if (lineNumber < 1 || lineNumber > state.doc.lines) continue;

    const lineInfo = state.doc.line(lineNumber);
    const column = Math.max(0, Math.min(diagnostic.column, lineInfo.length));
    const from = lineInfo.from + column;

    // Try to expand to the next word/token or until whitespace/end of line
    let to = from;
    const text = state.doc.sliceString(from, lineInfo.to);
    const match = text.match(/^\w+/);
    if (match) {
      to = from + match[0].length;
    } else {
      to = Math.min(from + 1, lineInfo.to);
    }
    if (to <= from) continue;

    const severityClass =
      diagnostic.category === "warning"
        ? "remotion-diagnostic--warning"
        : diagnostic.category === "suggestion"
          ? "remotion-diagnostic--info"
          : diagnostic.category === "message"
            ? "remotion-diagnostic--info"
            : "remotion-diagnostic--error";

    const mark = Decoration.mark({
      class: `remotion-diagnostic ${severityClass}`,
      attributes: {
        "data-remotion-diagnostic": diagnostic.message,
        title: diagnostic.message,
      },
    });
    ranges.push(mark.range(from, to));
  }

  return Decoration.set(ranges, true);
}

const diagnosticsField = StateField.define<ReturnType<typeof buildDecorations>>(
  {
    create(state) {
      return buildDecorations(state, []);
    },
    update(decorations, transaction) {
      let next = decorations.map(transaction.changes);

      for (const effect of transaction.effects) {
        if (effect.is(setDiagnosticsEffect)) {
          next = buildDecorations(transaction.state, effect.value);
        }
      }

      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  },
);

/**
 * CodeMirror extension that enables diagnostic decorations in the editor
 */
export const editorDiagnosticsExtension: Extension = [diagnosticsField];

/**
 * Apply diagnostic decorations to the editor
 */
export function applyEditorDiagnostics(
  view: EditorView,
  diagnostics: MarkdownDiagnostic[],
) {
  const effects = [setDiagnosticsEffect.of(diagnostics)];
  view.dispatch({
    effects,
  });
}

/**
 * Clear all diagnostic decorations from the editor
 */
export function clearEditorDiagnostics(view: EditorView) {
  const effects = [setDiagnosticsEffect.of([])];
  view.dispatch({
    effects,
  });
}

// ============================================================================
// Viewport Measurements
// ============================================================================

export function toBand(span: PreviewSpan, editorView: EditorView): Band | null {
  const start = span.pos;
  const end = span.pos + span.length;

  const startCoords = editorView.coordsAtPos(start + 1);
  const endCoords = editorView.coordsAtPos(end + 1);

  // If either end is not measurable (virtualized / folded)
  if (!startCoords || !endCoords) return null;

  const offset =
    editorView.scrollDOM.scrollTop -
    editorView.scrollDOM.getBoundingClientRect().top;

  const top = startCoords.top + offset;
  const bottom = endCoords.bottom + offset;
  const height = bottom - top;
  const center = top + height / 2;

  return { center, height };
}
// ============================================================================
// Language Service Extensions
// ============================================================================

/**
 * Create autocomplete extension that queries TypeScript Language Service
 */
export function createAutocompleteExtension(
  getCompletions: (
    pos: number,
    prefix?: string,
  ) => Promise<ts.CompletionEntry[]>,
): Extension {
  return autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        try {
          // Find the start of the word being typed
          const word = context.matchBefore(/[\w$]*/);
          const prefix = word ? word.text : "";

          // Let TypeScript do the filtering with the prefix
          const completions = await getCompletions(context.pos, prefix);

          if (completions.length === 0) {
            return null;
          }

          return {
            from: word ? word.from : context.pos,
            options: completions.map((entry) => ({
              label: entry.name,
              type: entry.kind,
              detail: entry.kindModifiers,
            })),
            // Disable filtering - TypeScript already filtered by prefix
            filter: false,
          };
        } catch (err) {
          console.error("[remotion] Autocomplete error:", err);
          return null;
        }
      },
    ],
    // Let CodeMirror handle theme - it should inherit from Obsidian
    closeOnBlur: true,
    activateOnTyping: true,
  });
}

/**
 * Map TypeScript displayPart kind to CodeMirror token class
 */
function mapDisplayPartKindToClass(kind: string): string {
  switch (kind) {
    case "keyword":
      return "cm-keyword";
    case "punctuation":
      return "cm-punctuation";
    case "space":
    case "lineBreak":
      return "";
    case "text":
      return "cm-type";
    case "parameterName":
    case "propertyName":
    case "fieldName":
      return "cm-property";
    case "functionName":
    case "methodName":
      return "cm-variableName cm-function";
    case "operator":
      return "cm-operator";
    case "stringLiteral":
      return "cm-string";
    case "numericLiteral":
      return "cm-number";
    case "className":
    case "interfaceName":
    case "typeParameterName":
    case "enumName":
      return "cm-typeName";
    default:
      return "cm-variableName";
  }
}

/**
 * Create hover tooltip extension that shows TypeScript type information
 */
export function createHoverExtension(
  getQuickInfo: (pos: number) => Promise<{
    displayParts: ts.SymbolDisplayPart[];
    documentation: ts.SymbolDisplayPart[];
  } | null>,
  renderMarkdown?: (markdown: string, container: HTMLElement) => void,
): Extension {
  return hoverTooltip(
    async (view: EditorView, pos: number): Promise<Tooltip | null> => {
      try {
        const info = await getQuickInfo(pos);

        if (!info) {
          return null;
        }

        return {
          pos,
          above: true,
          create: () => {
            const dom = document.createElement("div");
            dom.className = "tooltip remotion-hover-tooltip";

            // Render displayParts with syntax highlighting
            const code = document.createElement("div");
            code.className = "cm-line remotion-hover-tooltip__signature";

            for (const part of info.displayParts) {
              const span = document.createElement("span");
              const className = mapDisplayPartKindToClass(part.kind);
              if (className) {
                span.className = className;
              }
              span.textContent = part.text;
              code.appendChild(span);
            }

            dom.appendChild(code);

            // Add documentation if present
            if (info.documentation.length > 0) {
              const docDiv = document.createElement("div");
              docDiv.className = "remotion-hover-tooltip__doc";
              const markdownText = info.documentation
                .map((d) => d.text)
                .join("");
              if (renderMarkdown) {
                renderMarkdown(markdownText, docDiv);
              } else {
                docDiv.textContent = markdownText;
              }
              dom.appendChild(docDiv);
            }

            return { dom };
          },
        };
      } catch (err) {
        console.error("[remotion] Hover tooltip error:", err);
        return null;
      }
    },
  );
}
