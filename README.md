# Zebra Print Tester

POC isolada de impressão em impressoras Zebra via **WebUSB** (sem driver, sem PDF).
Quando o WebUSB não está disponível, cai automaticamente pro **preview Labelary** (renderiza ZPL como PNG online).

## Funcionalidades

- **Compor etiqueta** de teste (genérica, HU, Volume, Romaneio)
- **Imprimir** direto na Zebra USB (Chrome/Edge em secure context)
- **Preview Labelary** como fallback (não precisa de hardware)
- **Configurações de impressão** (dropdown ⚙️ no header):
  - Listar todas as Zebras pareadas no navegador
  - Selecionar a "padrão" (radio button, persistida em `localStorage`)
  - Botão "Imprimir teste" por impressora (pra identificar qual é qual fisicamente)
  - Remover pareamento individual
  - Adicionar nova impressora

## Stack

- Next.js 15 (App Router)
- React 19
- TypeScript strict
- MUI v6

## Setup

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Pré-requisitos WebUSB

- Chrome / Edge / Opera (Chromium-based) — Firefox e Safari **não** suportam
- Secure context: `https://` ou `localhost` (`http://localhost:3000` funciona)
- Outras origens HTTP exigem flag em `chrome://flags/#unsafely-treat-insecure-origin-as-secure`

## Como usar (com Zebra física)

1. Plugue a Zebra USB no PC
2. Abra http://localhost:3000
3. Clique em **Configurações** no header
4. Clique em **Adicionar impressora** → escolha a Zebra no diálogo do Chrome
5. (Se tiver várias) clique no botão **Imprimir teste** ao lado de cada uma pra identificar
6. Marque a default no radio button
7. Feche o dialog
8. Compose uma etiqueta no form e clique em **Imprimir agora**

## Como testar sem Zebra

Em qualquer navegador, qualquer ambiente: o botão **Imprimir agora** cai automaticamente pro modo preview Labelary — abre um modal mostrando o PNG da etiqueta como sairia da impressora. Útil pra validar layouts ZPL antes de ter hardware.

## Arquitetura

```
src/
├── lib/zebra/
│   ├── zpl.ts                # Builder ZPL puro (sem React)
│   ├── useZebraPrinter.ts    # Hook WebUSB (multi-device + localStorage)
│   └── labelary.ts           # POST ZPL → PNG (Labelary API)
└── components/
    ├── ToastProvider.tsx     # Snackbar minimalista
    ├── ZebraPrintButton.tsx  # Botão principal (mode=auto|usb|preview)
    └── PrinterSettingsDialog.tsx  # Modal de gerenciamento de impressoras
```
