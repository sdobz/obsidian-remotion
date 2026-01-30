import type { MarkdownView } from "obsidian";
import { EditorView, Decoration } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import type { MarkdownDiagnostic } from "remotion-md";

/**
 * Editor Integration Module
 *
 * Centralizes all CodeMirror interaction logic including:
 * - EditorView access from Obsidian MarkdownView
 * - Diagnostic decorations and visualization
 * - Editor state management
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
