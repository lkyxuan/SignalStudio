import React, { memo, useLayoutEffect, useState } from 'react';

type Props = {
  value?: string; field: string; reset: unknown;
  edit: (field: string, value: string) => void; commit: () => void;
  multiline?: boolean; rows?: number; placeholder?: string;
};
// Keep character-by-character updates inside the active control. The workspace
// receives a snapshot on blur; the draft store is updated synchronously on input.
export const DraftControl = memo(function DraftControl({value = '', field, reset, edit, commit, multiline, ...props}: Props) {
  const [text, setText] = useState(value ?? '');
  useLayoutEffect(() => { setText(value ?? ''); }, [value, reset]);
  const shared = { ...props, 'data-workspace-editor': 'node', value: text,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value;
      edit(field, next); setText(next);
    }, onBlur: commit };
  return multiline ? <textarea {...shared} /> : <input {...shared} />;
});
