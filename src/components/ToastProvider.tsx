'use client';

// Toast minimalista — mesma API que useToast() do WMS pra compatibilidade
// com o ZebraPrintButton/PrinterSettingsDialog copiados de lá.

import { Alert, Snackbar, type AlertColor } from '@mui/material';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

interface ToastState {
  open: boolean;
  message: string;
  severity: AlertColor;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ToastState>({
    open: false,
    message: '',
    severity: 'success',
  });

  const show = useCallback((message: string, severity: AlertColor) => {
    setState({ open: true, message, severity });
  }, []);

  const api: ToastApi = {
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={state.open}
        autoHideDuration={4000}
        onClose={() => setState((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          severity={state.severity}
          variant="filled"
          onClose={() => setState((s) => ({ ...s, open: false }))}
          sx={{ maxWidth: 480 }}
        >
          {state.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de <ToastProvider>');
  return ctx;
}
