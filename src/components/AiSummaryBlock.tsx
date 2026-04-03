import React from 'react';

function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    if (m) {
      return (
        <strong key={idx} className="font-semibold text-on-surface">
          {m[1]}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function normalizeSectionTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isKeywordsSectionTitle(title: string): boolean {
  const n = normalizeSectionTitle(title);
  return n === 'tu khoa' || n.startsWith('tu khoa ');
}

export type AiSummaryBlockProps = {
  text: string;
  /** @deprecated No longer adds an outer border; only the Keywords block is bordered */
  emphasizeCard?: boolean;
};

export function AiSummaryBlock({ text }: AiSummaryBlockProps) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (!trimmed.includes('##')) {
    const paras = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    return (
      <div className="space-y-3 text-sm leading-relaxed text-on-surface">
        {paras.length > 0 ? (
          paras.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {renderInlineBold(p)}
            </p>
          ))
        ) : (
          <p className="whitespace-pre-wrap">{renderInlineBold(trimmed)}</p>
        )}
      </div>
    );
  }

  const lines = trimmed.split('\n');
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const tm = lines[i].trimEnd().trim();
    if (!tm) {
      nodes.push(<div key={`empty-${i}`} className="h-1" />);
      continue;
    }

    let titleFromHeading: string | null = null;
    if (tm.startsWith('## ')) {
      titleFromHeading = tm.slice(3).trim();
    } else if (tm.startsWith('##')) {
      titleFromHeading = tm.replace(/^##\s*/, '').trim();
    }

    if (titleFromHeading !== null) {
      if (isKeywordsSectionTitle(titleFromHeading)) {
        const inner: React.ReactNode[] = [
          <h5
            key="kw-h"
            className="mb-2 font-headline text-[11px] font-extrabold uppercase tracking-wider text-primary"
          >
            {renderInlineBold(titleFromHeading)}
          </h5>,
        ];
        let j = i + 1;
        while (j < lines.length) {
          const sub = lines[j].trimEnd().trim();
          if (!sub) {
            inner.push(<div key={`kw-e-${j}`} className="h-1" />);
            j++;
            continue;
          }
          if (sub.startsWith('##')) break;
          if (/^[-*]\s+/.test(sub)) {
            inner.push(
              <div key={`kw-${j}`} className="flex gap-2 pl-0.5 font-bold">
                <span className="shrink-0 select-none font-extrabold text-primary">•</span>
                <span className="min-w-0 flex-1 font-bold">
                  {renderInlineBold(sub.replace(/^[-*]\s+/, ''))}
                </span>
              </div>,
            );
          } else {
            inner.push(
              <p key={`kw-${j}`} className="font-bold leading-relaxed text-on-surface">
                {renderInlineBold(sub)}
              </p>,
            );
          }
          j++;
        }
        nodes.push(
          <div
            key={`kw-wrap-${i}`}
            className="-translate-y-[2px] space-y-2 rounded-lg border-2 border-primary/35 bg-primary/10 p-3 text-sm font-bold text-on-surface shadow-sm"
          >
            {inner}
          </div>,
        );
        i = j - 1;
        continue;
      }

      nodes.push(
        <h5
          key={`h-${i}`}
          className="mt-4 font-headline text-[11px] font-bold uppercase tracking-wider text-primary first:mt-0"
        >
          {renderInlineBold(titleFromHeading)}
        </h5>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(tm)) {
      nodes.push(
        <div key={`b-${i}`} className="flex gap-2 pl-0.5">
          <span className="shrink-0 select-none font-bold leading-relaxed text-primary">•</span>
          <span className="min-w-0 flex-1 leading-relaxed text-on-surface">
            {renderInlineBold(tm.replace(/^[-*]\s+/, ''))}
          </span>
        </div>,
      );
      continue;
    }

    nodes.push(
      <p key={`p-${i}`} className="leading-relaxed text-on-surface">
        {renderInlineBold(tm)}
      </p>,
    );
  }

  return <div className="space-y-1.5 text-sm">{nodes}</div>;
}
