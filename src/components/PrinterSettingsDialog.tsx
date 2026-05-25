'use client';

// Modal de configuração de impressoras Zebra.
// Acionado pelo dropdown do usuário no TopBar.
//
// Funções:
//   - Lista impressoras pareadas (vendor Zebra + USB Printer Class genérica)
//   - Radio button: escolhe a "default" (persistida em localStorage via useZebraPrinter)
//   - Botão "Adicionar impressora" → abre o diálogo nativo do Chrome
//   - Por impressora: botão "Imprimir teste" + botão "Remover"
//   - Estado de WebUSB indisponível (Firefox/Safari/HTTP) com explicação

import {
  Add,
  Cable,
  CheckCircle,
  Close,
  Delete,
  Info,
  Print,
  Warning,
} from '@mui/icons-material';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Radio,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useCallback, useState } from 'react';

import { useZebraPrinter } from '@/lib/zebra/useZebraPrinter';
import { buildZpl } from '@/lib/zebra/zpl';
import { useToast } from '@/components/ToastProvider';

export interface PrinterSettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function PrinterSettingsDialog({ open, onClose }: PrinterSettingsDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const {
    supported,
    devices,
    selectedId,
    status,
    error,
    connect,
    selectDevice,
    forgetDeviceById,
    printRaw,
  } = useZebraPrinter();

  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const handleAdd = useCallback(async () => {
    setConnecting(true);
    try {
      await connect();
      toast.success('Impressora adicionada e selecionada como padrão.');
    } catch {
      // erros já mostrados via hook
    } finally {
      setConnecting(false);
    }
  }, [connect, toast]);

  const handleRemove = useCallback(
    async (id: string, label: string) => {
      setBusyDeviceId(id);
      try {
        const res = await forgetDeviceById(id);
        if (res.forgotten) {
          toast.success(`Impressora "${label}" removida.`);
        } else if (!res.supported) {
          toast.error(
            'Seu navegador não suporta device.forget() (Chrome <100). Revogue manualmente em chrome://settings/content/usbDevices.',
          );
        } else {
          toast.error('Não foi possível remover a impressora.');
        }
      } finally {
        setBusyDeviceId(null);
      }
    },
    [forgetDeviceById, toast],
  );

  const handleTestPrint = useCallback(
    async (id: string, label: string) => {
      // Seleciona temporariamente pra imprimir nessa específica.
      const previousId = selectedId;
      selectDevice(id);
      setBusyDeviceId(id);
      try {
        const zpl = buildZpl({
          kind: 'generic',
          title: 'TESTE',
          subtitle: 'Pareamento OK',
          barcodeValue: id.slice(0, 20),
          fields: [
            { label: 'Impressora', value: label },
            { label: 'Hora', value: new Date().toLocaleString('pt-BR') },
          ],
          footer: 'Etiqueta de teste — WMS Orquest',
        });
        await printRaw(zpl);
        toast.success(`Etiqueta de teste enviada para "${label}".`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Falha no teste: ${msg}`);
        // restaura seleção anterior em caso de erro
        if (previousId && previousId !== id) selectDevice(previousId);
      } finally {
        setBusyDeviceId(null);
      }
    },
    [selectDevice, selectedId, printRaw, toast],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Print color="primary" />
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Configurações de impressão
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Gerencie as impressoras Zebra pareadas neste navegador
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Fechar">
            <Close />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers>
        {!supported && (
          <Stack
            spacing={1}
            alignItems="flex-start"
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: alpha(theme.palette.warning.main, 0.08),
              border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Warning color="warning" />
              <Typography variant="subtitle2" fontWeight={700}>
                WebUSB indisponível
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary">
              Use Google Chrome ou Microsoft Edge em HTTPS (ou localhost). Em dev com domínio{' '}
              <code>.test</code>, adicione a origem em{' '}
              <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>.
            </Typography>
          </Stack>
        )}

        {supported && devices.length === 0 && (
          <Stack alignItems="center" spacing={2} sx={{ py: 4 }}>
            <Cable sx={{ fontSize: 48, color: 'text.disabled' }} />
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Nenhuma impressora pareada ainda.
              <br />
              Clique em <strong>Adicionar impressora</strong> pra conectar a primeira.
            </Typography>
          </Stack>
        )}

        {supported && devices.length > 0 && (
          <>
            <Stack
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ mb: 1, color: 'text.secondary' }}
            >
              <Info sx={{ fontSize: 16 }} />
              <Typography variant="caption">
                A impressora selecionada (radio marcado) recebe todos os prints da aplicação.
              </Typography>
            </Stack>
            <List
              disablePadding
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 1,
                overflow: 'hidden',
              }}
            >
              {devices.map((d, idx) => {
                const isSelected = d.id === selectedId;
                const isBusy = busyDeviceId === d.id;
                const isActiveStatus = isSelected && status === 'printing';
                return (
                  <ListItem
                    key={d.id}
                    divider={idx < devices.length - 1}
                    sx={{
                      py: 1.5,
                      bgcolor: isSelected
                        ? alpha(theme.palette.primary.main, 0.04)
                        : 'transparent',
                      transition: 'background-color 0.15s',
                    }}
                  >
                    <Radio
                      edge="start"
                      checked={isSelected}
                      onChange={() => selectDevice(d.id)}
                      disabled={isBusy}
                      sx={{ mr: 1 }}
                    />
                    <ListItemText
                      primary={
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography variant="body2" fontWeight={isSelected ? 700 : 500}>
                            {d.productName ?? 'Impressora USB'}
                          </Typography>
                          {d.isZebra && (
                            <Chip
                              label="Zebra"
                              size="small"
                              color="primary"
                              variant="outlined"
                              sx={{ height: 18, fontSize: 10, fontWeight: 600 }}
                            />
                          )}
                          {isSelected && (
                            <Chip
                              icon={<CheckCircle sx={{ fontSize: 14 }} />}
                              label="Padrão"
                              size="small"
                              color="success"
                              sx={{ height: 18, fontSize: 10, fontWeight: 600 }}
                            />
                          )}
                          {isActiveStatus && (
                            <CircularProgress size={12} sx={{ ml: 0.5 }} />
                          )}
                        </Stack>
                      }
                      secondary={
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ fontSize: 11, color: 'text.disabled' }}
                        >
                          {d.manufacturerName && <span>{d.manufacturerName}</span>}
                          {d.serialNumber && <span>S/N: {d.serialNumber}</span>}
                          <span>
                            VID: {d.vendorId.toString(16).padStart(4, '0').toUpperCase()} ·
                            PID: {d.productId.toString(16).padStart(4, '0').toUpperCase()}
                          </span>
                        </Stack>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Imprimir etiqueta de teste nesta impressora">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleTestPrint(d.id, d.label)}
                            disabled={isBusy}
                          >
                            {isBusy ? <CircularProgress size={16} /> : <Print fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Remover pareamento desta impressora">
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemove(d.id, d.label)}
                            disabled={isBusy}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                );
              })}
            </List>

            {error && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
                {error}
              </Typography>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          variant="contained"
          startIcon={connecting ? <CircularProgress size={16} color="inherit" /> : <Add />}
          onClick={handleAdd}
          disabled={!supported || connecting}
          sx={{ textTransform: 'none' }}
        >
          {connecting ? 'Aguardando seleção…' : 'Adicionar impressora'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}
