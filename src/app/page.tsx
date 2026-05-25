'use client';

// Página única do Zebra Print Tester.
//
// Funcionalidades:
//   - Header: nome + botão "Configurações de impressão" (abre PrinterSettingsDialog)
//   - Form: escolhe tipo de etiqueta (genérica / HU / Volume / Romaneio) + campos
//   - Botão "Imprimir Zebra" (mode=auto: USB se disponível, Labelary preview fallback)

import { Print, Settings } from '@mui/icons-material';
import {
  Box,
  Button,
  Container,
  Divider,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMemo, useState } from 'react';

import { PrinterSettingsDialog } from '@/components/PrinterSettingsDialog';
import { ZebraPrintButton } from '@/components/ZebraPrintButton';
import type { ZebraLabelInput } from '@/lib/zebra/zpl';

type LabelKind = 'generic' | 'hu' | 'volume' | 'load';

export default function HomePage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [kind, setKind] = useState<LabelKind>('hu');
  const [code, setCode] = useState('HU-2026-TESTE');
  const [customerName, setCustomerName] = useState('ACME Logística Ltda');
  const [carrierName, setCarrierName] = useState('Transportadora Veloz');
  const [extraField, setExtraField] = useState('');
  const [copies, setCopies] = useState(1);

  // Monta o ZebraLabelInput conforme o kind selecionado.
  const label: ZebraLabelInput = useMemo(() => {
    switch (kind) {
      case 'hu':
        return {
          kind: 'hu',
          code,
          customerName,
          carrierName: carrierName || null,
          typeName: extraField || 'Palete',
          copies,
        };
      case 'volume':
        return {
          kind: 'volume',
          code,
          separationOrderCode: extraField || 'OS-2026-00001',
          customerName,
          copies,
        };
      case 'load':
        return {
          kind: 'load',
          code,
          customerName,
          carrierName: carrierName || null,
          driverName: extraField || undefined,
          copies,
        };
      case 'generic':
      default:
        return {
          kind: 'generic',
          title: code,
          subtitle: customerName || undefined,
          barcodeValue: code,
          fields: [
            { label: 'Campo extra', value: extraField || '—' },
            { label: 'Transp.', value: carrierName || '—' },
          ],
          footer: `Impresso ${new Date().toLocaleString('pt-BR')}`,
          copies,
        };
    }
  }, [kind, code, customerName, carrierName, extraField, copies]);

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Zebra Print Tester
          </Typography>
          <Typography variant="caption" color="text.secondary">
            POC isolada — WebUSB direto, preview Labelary como fallback
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<Settings />}
          onClick={() => setSettingsOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          Configurações
        </Button>
      </Stack>

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: '1px solid #e0e0e0' }}>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
          Compor etiqueta de teste
        </Typography>

        <Stack spacing={2}>
          <TextField
            select
            label="Tipo de etiqueta"
            value={kind}
            onChange={(e) => setKind(e.target.value as LabelKind)}
            fullWidth
            size="small"
          >
            <MenuItem value="generic">Genérica (título + barcode + campos)</MenuItem>
            <MenuItem value="hu">Unitizador (HU)</MenuItem>
            <MenuItem value="volume">Volume (separação)</MenuItem>
            <MenuItem value="load">Romaneio (load)</MenuItem>
          </TextField>

          <TextField
            label="Código / Título"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            fullWidth
            size="small"
            helperText="Valor codificado no barcode CODE128"
          />

          <TextField
            label={kind === 'generic' ? 'Subtítulo' : 'Cliente'}
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            fullWidth
            size="small"
          />

          <TextField
            label="Transportadora"
            value={carrierName}
            onChange={(e) => setCarrierName(e.target.value)}
            fullWidth
            size="small"
          />

          <TextField
            label={
              kind === 'hu'
                ? 'Tipo (palete/gaiola/saca/contêiner)'
                : kind === 'volume'
                  ? 'OS de separação'
                  : kind === 'load'
                    ? 'Motorista'
                    : 'Campo extra'
            }
            value={extraField}
            onChange={(e) => setExtraField(e.target.value)}
            fullWidth
            size="small"
          />

          <TextField
            label="Cópias"
            type="number"
            value={copies}
            onChange={(e) => setCopies(Math.max(1, Number(e.target.value) || 1))}
            inputProps={{ min: 1, max: 10 }}
            fullWidth
            size="small"
          />
        </Stack>

        <Divider sx={{ my: 3 }} />

        <Stack direction="row" spacing={1.5} alignItems="center">
          <ZebraPrintButton
            label={label}
            mode="auto"
            variant="contained"
            color="primary"
            sx={{ fontWeight: 700 }}
          >
            <Print sx={{ mr: 1, fontSize: 18 }} /> Imprimir agora
          </ZebraPrintButton>
          <Typography variant="caption" color="text.secondary">
            Mode <strong>auto</strong>: usa WebUSB se disponível, ou abre preview Labelary
          </Typography>
        </Stack>
      </Paper>

      <Box sx={{ mt: 3, p: 2, bgcolor: '#fff8e1', borderRadius: 1, border: '1px solid #ffe082' }}>
        <Typography variant="caption" color="text.secondary">
          <strong>Pré-requisitos WebUSB:</strong> Chrome ou Edge em HTTPS ou localhost.
          Em dev local funciona em <code>http://localhost:3000</code>.
          Outras origens HTTP exigem flag{' '}
          <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code>.
        </Typography>
      </Box>

      <PrinterSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </Container>
  );
}
