import { useCallback } from 'react';
import { ApiError } from '../api';
import { useToast, type ToastApi } from '../components/Toast';

export interface UndoRequest {
  /** 「已改成：不来」 */
  message: string;
  /** The reverse write. */
  undo: () => Promise<unknown>;
  /** Default '撤销'. */
  undoLabel?: string;
  /** Default '已撤销'. */
  undoneMessage?: string;
  /** e.g. reload + onChanged. */
  onUndone?: () => void;
}

const UNDO_LABEL = '撤销';
const UNDONE_MESSAGE = '已撤销';
const UNDO_FAILED = '撤销没成功，请稍后重试';

async function runUndo(toast: ToastApi, request: UndoRequest): Promise<void> {
  try {
    await request.undo();
  } catch (err) {
    toast.show({
      tone: 'error',
      message: err instanceof ApiError ? `撤销没成功：${err.message}` : UNDO_FAILED,
    });
    return;
  }
  toast.show({ tone: 'ok', message: request.undoneMessage ?? UNDONE_MESSAGE });
  request.onUndone?.();
}

/**
 * Shows a toast with an undo action. The action is one click, then the toast
 * goes away (no double undo); the outcome is reported in a toast of its own.
 */
export function useUndo(): (request: UndoRequest) => void {
  const toast = useToast();
  return useCallback(
    (request: UndoRequest): void => {
      toast.show({
        message: request.message,
        action: { label: request.undoLabel ?? UNDO_LABEL, onAction: () => void runUndo(toast, request) },
      });
    },
    [toast],
  );
}
