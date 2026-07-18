type DraftSource = {
  sourceType: 'hot_tracking' | 'track' | 'manual_input' | 'unknown';
  trackId?: string;
  trackName?: string;
  topicId?: string;
  topicTitle?: string;
  inputText?: string;
};

type StructuredDraft = {
  noteTitle: string;
  titleOptions?: string[];
  hook: string;
  body: string[];
  ending: string;
  tags: string[];
  coverSuggestion?: {
    mainText?: string;
    layout?: string;
    visualStyle?: string;
  };
  imageTextStructure?: string[];
  cardPreview?: {
    keywords: string[];
  };
};

export type DraftFingerprintItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  status?: '待优化' | '已完成';
  source?: string;
  draftSource?: DraftSource;
  tags?: string[];
  updatedAt?: string;
  cardPreview?: {
    keywords: string[];
  };
  structured?: StructuredDraft;
};

export function buildDraftFingerprint(draft: DraftFingerprintItem) {
  return JSON.stringify({
    title: draft.title,
    body: draft.body,
    createdAt: draft.createdAt,
    status: draft.status ?? '',
    source: draft.source ?? '',
    draftSource: draft.draftSource
      ? {
          sourceType: draft.draftSource.sourceType,
          trackId: draft.draftSource.trackId ?? '',
          trackName: draft.draftSource.trackName ?? '',
          topicId: draft.draftSource.topicId ?? '',
          topicTitle: draft.draftSource.topicTitle ?? '',
          inputText: draft.draftSource.inputText ?? '',
        }
      : null,
    tags: draft.tags ?? [],
    updatedAt: draft.updatedAt ?? '',
    cardPreview: draft.cardPreview?.keywords ?? [],
    structured: draft.structured
      ? {
          noteTitle: draft.structured.noteTitle,
          titleOptions: draft.structured.titleOptions ?? [],
          hook: draft.structured.hook,
          body: draft.structured.body,
          ending: draft.structured.ending,
          tags: draft.structured.tags,
          coverSuggestion: draft.structured.coverSuggestion
            ? {
                mainText: draft.structured.coverSuggestion.mainText ?? '',
                layout: draft.structured.coverSuggestion.layout ?? '',
                visualStyle: draft.structured.coverSuggestion.visualStyle ?? '',
              }
            : null,
          imageTextStructure: draft.structured.imageTextStructure ?? [],
          cardPreview: draft.structured.cardPreview?.keywords ?? [],
        }
      : null,
  });
}

export function hasUnsavedDraftChanges(currentDraft: DraftFingerprintItem | null, baselineDrafts: DraftFingerprintItem[]) {
  if (!currentDraft) return false;

  const baselineDraft = baselineDrafts.find((draft) => draft.id === currentDraft.id);
  if (!baselineDraft) return true;

  return buildDraftFingerprint(currentDraft) !== buildDraftFingerprint(baselineDraft);
}
