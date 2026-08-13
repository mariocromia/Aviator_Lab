# Coletor histórico

O aplicativo mantém dois bancos independentes no diretório de dados do Electron:

- `aviator-strategy-lab.db`: banco operacional, com retenção de 10.000 rodadas por plataforma;
- `aviator-round-archive.db`: histórico para IA e backtests, com retenção de 300.000 rodadas por feed.

As 16 plataformas pré-instaladas usam quatro UUIDs TipMiner. Rodadas de plataformas com o mesmo UUID são armazenadas fisicamente uma única vez e relacionadas às plataformas pelo catálogo. Assim, cada plataforma acessa até 300.000 rodadas sem multiplicar o tamanho do arquivo.

## Execução em segundo plano

Quando habilitado em **Configurações → Coletor histórico independente**, fechar a janela mantém o processo na bandeja do Windows. Em uma instalação empacotada, o coletor também é registrado para iniciar com o Windows usando o argumento `--background`. Use **Encerrar coletor** no menu da bandeja para finalizar o processo.

## Google Drive

Instale o Google Drive para computador e selecione uma pasta local sincronizada. Existem dois modos:

- **Coletor central**: publica um snapshot a cada 15 minutos e permite publicação manual;
- **Usuário**: verifica e importa o snapshot compartilhado a cada 15 minutos.

O SQLite em uso nunca é aberto diretamente na pasta compartilhada. O coletor faz checkpoint do WAL, copia um snapshot consistente e publica `AviatorData/manifest.json` somente depois de calcular o SHA-256. O usuário valida o hash antes de importar com `INSERT OR IGNORE`, preservando seu banco local e evitando conflitos de escrita.

Somente um computador deve ser configurado como coletor central para uma determinada pasta. Os demais devem usar o modo usuário.

## Plataformas instaladas

- `48323e32-3590-4e2f-b6fe-09d5fbc811c9`: SorteNaBet, EstrelaBet, APOSTAMAX, ApostaOnline, ApostaTudo, Brabet, Esportes da Sorte e VBet;
- `997b99e3-4977-4fcf-ac6d-3834a384d141`: Betou, BetFusion e ApostaGanha;
- `b72e7e9f-7a68-4d2d-b6b7-e67c3ba6c323`: Betfair, Betnacional, Blaze e Jonbet;
- `dddfce2b-42dc-4fd5-afd8-a5ee0ef36f89`: BravoBet.

O backtest consulta primeiro o arquivo histórico e aceita até 300.000 rodadas. O Analista IA também usa o arquivo histórico para os cálculos de plataforma, mantendo o limite de amostra próprio da interface para controlar o volume enviado ao modelo.
