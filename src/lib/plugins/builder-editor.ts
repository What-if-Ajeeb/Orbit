import type { BuilderDraft } from './builder';

export type BuilderEditorText = {
  input: string;
  settings: string;
  testInput: string;
  [key: string]: string;
};

/** Derives the raw JSON text shown in the builder's text fields from a draft. */
export function editorText(draft: BuilderDraft): BuilderEditorText {
  const text: BuilderEditorText = {
    input: JSON.stringify(draft.inputParameters ?? { type: 'object', properties: {} }, null, 2),
    settings: draft.settings.length > 0 ? JSON.stringify(draft.settings, null, 2) : '',
    testInput: '{\n  "value": "hello"\n}',
  };

  for (const action of draft.actions) {
    text[`${action.id}.inputSchema`] = JSON.stringify(action.inputSchema ?? {}, null, 2);
    text[`${action.id}.outputSchema`] = JSON.stringify(action.outputSchema ?? {}, null, 2);
  }

  return text;
}
