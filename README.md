# Aviator Strategy Lab

Aplicativo desktop local para análise quantitativa, estratégias multi-terminal e automação assistida do Aviator.

## Primeira execução

Na primeira execução, defina as credenciais MASTER por variáveis de ambiente. No PowerShell:

```powershell
$env:AVIATOR_MASTER_EMAIL='seu-email@exemplo.com'
$env:AVIATOR_MASTER_PASSWORD='escolha-uma-senha-forte'
npm.cmd install
npm.cmd run dev
```

Depois que o usuário for criado no banco local, não é necessário manter essas variáveis. Nunca salve a senha no repositório.

O banco usa o SQLite nativo do Node embarcado no Electron e é criado no diretório de dados da aplicação. A senha é persistida somente como hash bcrypt.

## Estrutura

- `apps/desktop`: Electron, React, Vite e interface.
- `packages/shared`: contratos, validação e tipos de domínio.
- `packages/terminal`: regras puras de criação e duplicação de Terminais.
- `packages/tipminer`: cliente HTTP, normalização, deduplicação e classificação LIVE/BACKLOG.
- `packages/collector`: barramento de rodadas e distribuição por plataforma.
- `docs`: decisões e roteiro incremental.

## Recursos concluídos

- plataformas TipMiner com UUID compartilhável, coleta incremental, deduplicação e classificação LIVE/BACKLOG;
- Terminais independentes com estratégias, planos, horários, regras entre Terminais e motivo explícito de pausa;
- construtores visuais em português para Game Strategy, Bet Strategy e planos BASE/GALE;
- valores fixos, percentuais, multiplicadores, sequências, tabela manual, recuperação e fórmula aritmética segura;
- banca com stop WIN/LOSS, drawdown, exposição, percentual máximo, extrato, Histórico e visão de Gales;
- backtest/replay determinístico, curva de banca, relatório e exportação CSV/JSON;
- automação assistida com perfil por Terminal, calibração, fila global, trava por Terminal e parada de emergência `Ctrl+Shift+F12`;
- backup completo, importação idempotente, snapshots restauráveis, auditoria “Por quê?” e benchmark 10/20/50/100.

### Retenção local

- até 10.000 rodadas persistidas por plataforma;
- histórico operacional de cada Terminal mantido por até 30 dias;
- limpeza automática horária, com índices dedicados e preservação de registros ainda referenciados;
- Monitor ao vivo paginado em 50, 100, 250 ou 500 rodadas e filtro por casa de aposta.

## Screen Agent opcional

O modo `SIMULATION` não precisa de Python. Para testes físicos no modo `ASSISTED`, instale as dependências:

```bash
python -m pip install -r apps/desktop/python/requirements.txt
```

O agente pode focar a janela, preencher valores e posicionar o cursor no botão configurado. A ação financeira final permanece bloqueada e depende do usuário. A automação sempre inicia pausada.

## Validação

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

Consulte [docs/architecture.md](docs/architecture.md) para as fronteiras dos módulos.
