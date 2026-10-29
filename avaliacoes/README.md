# Conjuntos de referência (golden sets)

Para saber se uma mudança de prompt ou de modelo melhorou ou piorou, o produto compara a nota
que a IA dá com a nota que o Gustavo daria (`estrategia/briefing-e-rubricas.md`, seção 8).

## Pelo lote, metade do preço

Todos os scripts `avaliar:*` mandam os casos de cada etapa num lote só pela API de lote (`scripts/golden-lote.ts`, `src/ia/lote.ts`) e esperam o resultado: roteiros num
lote, depois o verificador num segundo lote só dos casos que a checagem local aprovou. Mesmos prompts, mesmo schema, mesmo esforço; o custo impresso já é o do lote (metade do
preço cheio, x0,5). Atenção: o lote não devolve os tokens de cache de prompt, então esse custo é calculado só por entrada e saída e pode ficar acima do que o console da Anthropic cobra de verdade; na dúvida, vale o console. Um caso que o lote devolve com erro é impresso com o motivo e contado ("casos que falharam no lote"), e os outros seguem; erro de rede na consulta do lote é tentado de novo algumas vezes antes de desistir. Um lote leva de minutos a algumas horas (a API promete até 24 h; o script consulta de 30 em 30 segundos). Os scripts de roteiro (`roteiros`, `momentos`, `stories`, `roteiros-sem-fala`) passam pelo MESMO caminho da produção (`scripts/golden-producao.ts`): a 1ª tentativa de todos os casos, a conferência local (com a correção mecânica de travessão, emoji e "voce" sem acento) e a do `verificarTexto` com as fontes dos fatos, e só os reprovados refazem, com o motivo, na 2ª tentativa; o resumo imprime "reprovado na 1ª tentativa: N, reprovado nas duas (ErroIA em produção): M", e o número que decide o deploy é M. `--direto` (ou `GOLDEN_SET_DIRETO=1`), em qualquer `avaliar:*` (por exemplo `npm run avaliar:roteiros -- --direto`), manda as mesmas chamadas pelo caminho normal, até 4 em paralelo, sem esperar a fila do lote (útil quando ele está parado na fila da API e o resultado é preciso agora); o custo é o preço cheio, o dobro do lote, e o cabeçalho avisa. O padrão continua sendo o lote. `GOLDEN_SEM_LOTE=1 npm run avaliar:roteiros` volta ao
um por vez, pelo preço cheio, para depurar um caso. No mock tudo responde na hora, igual a antes.

## Por que o arquivo real não está aqui

O repositório é público (`plataforma/CLAUDE.md`). O conjunto de referência real usa as
respostas de verdade do primeiro cliente de teste, e respostas de verdade de cliente não
entram no repositório, nem em teste nem em fixture.

O script `npm run avaliar:briefing` procura o arquivo real em
`GOLDEN_SET_DIR/briefing.json`. `GOLDEN_SET_DIR` é uma variável de ambiente; o padrão, se ela
não estiver definida, é `../avaliacoes-privadas`, uma pasta irmã de `plataforma/`, fora do
repositório. Se o arquivo real não existir nesse caminho, o script roda com
`briefing.exemplo.json` (fictício, neste diretório) e avisa no terminal que é exemplo.

Quando o Gustavo preencher `avaliacoes-privadas/briefing.json` com as respostas reais, o
script passa a usar o arquivo real automaticamente, sem mudar nenhum comando.

## Formato de `briefing.json` e `briefing.exemplo.json`

Uma lista de casos. Cada caso é uma resposta de uma pergunta do briefing, a nota que o
Gustavo daria a ela, e o ponto principal do porquê:

```json
[
  {
    "perguntaId": "p1",
    "resposta": "o texto da resposta, como o cliente escreveria",
    "notaEsperada": 8,
    "pontoPrincipal": "por que essa e a nota certa, em uma frase"
  }
]
```

- `perguntaId`: um dos ids de `src/config/briefing.ts` (`p1` a `p12`).
- `resposta`: o texto que entra em `avaliarResposta` como se fosse a resposta do cliente.
- `notaEsperada`: de 0 a 10, a nota que o Gustavo dá para essa resposta.
- `pontoPrincipal`: uma frase dizendo o que mais pesa na nota (serve para ler o resultado
  do script sem abrir o caso de novo).

`briefing-e-rubricas.md`, seção 8, pede 15 casos no conjunto real. `briefing.exemplo.json`
tem 15 casos fictícios só para o script ter o que rodar antes do arquivo real existir.

## Como rodar

```bash
npm run avaliar:briefing
```

Imprime a nota que a IA deu, a nota esperada, a diferença e o ponto principal de cada caso, e
a diferença média no final. Meta do plano: diferença média abaixo de 1,0.

## Formato de `temas.json` e `temas.exemplo.json` (etapa 10)

Mesma ideia, para a nota de tema em cinco pilares (`briefing-e-rubricas.md`, seção 6). Cada
caso já traz a evidência e o perfil compilado fixos, para medir só o julgamento do modelo
diante do mesmo material, sem tocar banco nem cliente real:

```json
[
  {
    "tema": "o assunto proposto pelo cliente",
    "perfilCompilado": "o perfil compilado, como se fosse o resumo de um cliente real",
    "modeloNicho": "o modelo do nicho, como se fosse o resumo do job modeloNicho",
    "persona": "negocio",
    "evidencias": [{ "id": 1, "assunto": "assunto do video", "foraDaCurva": 5.2 }],
    "notaEsperada": { "viralizar": 9, "gerarCliente": 8, "encaixe": 8, "novidade": 6, "facilidade": 9 },
    "pontoPrincipal": "por que essa e a nota certa, em uma frase"
  }
]
```

`GOLDEN_SET_DIR/temas.json` é o real (mesma variável de ambiente, mesmo padrão de fallback
para o exemplo). `PROXIMO.md`, decisão 7 da etapa 10, pede 10 casos fictícios no exemplo.

```bash
npm run avaliar:temas
```

Imprime, por caso, a nota que a IA deu e a esperada em cada um dos cinco pilares, e a
diferença média por pilar no final. Meta: diferença média abaixo de 1,5.

## Formato de `stories.json` e `stories.exemplo.json` (V9c)

O roteiro em Story não tem nota de 0 a 10 (mesmo raciocínio de `roteiros.exemplo.json` e
`momentos.exemplo.json`): o julgamento é "o Gustavo leria isso e gravaria?". Cada caso é
origem "tema" (como `roteiros.json`, com `tema` e `evidencias`) ou origem "momento" (como
`momentos.json`, com o bloco `momento`), nunca os dois. `GOLDEN_SET_DIR/stories.json` é o
real; sem ele, roda com `stories.exemplo.json`, cinco casos fictícios da Dr.Wash e da viagem
do Bruno.

```bash
npm run avaliar:stories
```

Imprime cada cartão gerado (o que falar, o que mostrar, o texto na tela, a figurinha), o
"por que assim", e quantos casos o verificador de produção (checagem por regra `R-IG-STORY`
mais `verificarTexto`) reprovaria.

## Formato de `roteiros-sem-fala.json` e `roteiros-sem-fala.exemplo.json` (M4)

O roteiro sem fala também não tem nota de 0 a 10, mesmo raciocínio de `stories.exemplo.json`.
Cada caso é origem "tema" ou origem "momento", nunca os dois, e `formato` ("reels" ou "story",
padrão "reels") escolhe o formato; o estilo é sempre "sem_fala" neste conjunto, não precisa
declarar. `GOLDEN_SET_DIR/roteiros-sem-fala.json` é o real; sem ele, roda com
`roteiros-sem-fala.exemplo.json`, três casos fictícios de uma oficina de envelopamento
automotivo.

```bash
npm run avaliar:roteiros-sem-fala
```

Imprime cada cena gerada (o que falar, que precisa sair vazio, o que mostrar, o texto na
tela), a legenda do post, e quantos casos o verificador de produção (checagem com
`estilo: "sem_fala"` mais `verificarTexto`) reprovaria.

## Formato de `roteiros-longos.json` e `roteiros-longos.exemplo.json` (E52 PR 3)

O roteiro longo do YouTube não tem nota de 0 a 10: o que dá para medir por código é conferido, e o resto fica impresso para leitura humana. Cada caso é origem "tema" ou "momento", nunca
os dois, e traz o que o servidor leria do banco: `duracaoDoRamo` (os percentis, a amostra e a `forca`, "regra" ou "indicio"; a duração do roteiro é a mediana arredondada a 30 segundos,
pela mesma função do servidor), `estruturaDoRamo` (a lista de capítulos típica, ou `null`), `titulosDoRamo`, `referencias` (a leitura da estrutura de até três vídeos longos, com `id`) e
os opcionais de sempre (`roteirosRecentes`, `regrasCliente`, `tipo`). `GOLDEN_SET_DIR/roteiros-longos.json` é o real; sem ele, roda com `roteiros-longos.exemplo.json`, seis casos
fictícios (limpeza, clínica odontológica, personal trainer, cafeteria no momento, confeitaria com regra firme e oficina mecânica).

```bash
npm run avaliar:roteiros-longos
```

Imprime cada capítulo (o nome, o início calculado, a duração, os pontos, o que a câmera mostra, o gancho para o próximo), o "Copiar os capítulos" e quantos casos o verificador de produção
(os capítulos conferidos por código, R-YT-VIDEO-05 a 08, mais `verificarTexto`) reprovaria. Conta também o que o formato do capítulo promete: quantos ganchos vieram inteiros (de 4 a 40
palavras) e quantos pontos passam de 20 palavras. Sob o simulador (`AI_PROVIDER=mock`) não custa nada e prova o que o código confere; o que o modelo escreve só a rodada com chave mede.

## Formato de `entender-marca.json` e `entender-marca.exemplo.json` (E38 PR 2)

A tarefa `entenderMarca` ("o que entendemos da sua marca") também não tem nota de 0 a 10: o que dá para
medir por código é conferido, e o resto (se um item é um fato inventado) fica impresso para leitura
humana. Cada caso é uma marca: `tipo` ("negocio" ou "pessoa"), `nomeDaMarca`, `resumoDoBriefing` (só
para a IA comparar), `site` (`endereco` mais `paginas` com `caminho` e `texto`, ou `null`), `redes`
(`rede`, `handle` e `videos` com `titulo` e `views`; a mediana e o "quantas vezes passa dela" são
calculados pelo script com o mesmo código de produção, nunca pela IA). Opcionais: `itensAtuais` (os que
já existem, com `id`, `categoria`, `origem`, `estado` e `texto`), `itensTirados` (o que a pessoa tirou),
`naoDeveConter` (trechos que o caso escondeu no site como "instrução", que a IA nunca pode obedecer) e
`deveReusarId` (os ids que a IA precisa reaproveitar) e `deveConter` (texto que algum item tem de trazer; só com a chave real, o mock devolve um texto fixo). `GOLDEN_SET_DIR/entender-marca.json` é o real; sem
ele, roda com `entender-marca.exemplo.json`, sete casos fictícios (uma loja de limpeza, uma clínica, uma
personal trainer, uma padaria com instrução escondida, um estúdio americano com site em inglês, um caso
com itens que já existem, e um perfil com poucos vídeos e uma visualização sem dado).

```bash
npm run avaliar:entender-marca
```

Imprime os itens de cada caso e, por caso, as conferências automáticas (origem que não foi lida, item de
"rendeu" sem número, item de "rendeu" com um número que a entrada não trouxe, id inventado, item que a pessoa
tirou voltando, instrução escondida obedecida, reprovação no verificador de produção, e, só com a chave real,
o texto que o caso exige em algum item, `deveConter`). Cada uma tem de dar zero. **Um caso que dá erro ao
avaliar conta como erro (não como "sem problema"), e qualquer erro ou conferência vermelha deixa o resultado
vermelho e o código de saída em 1.** Prova com chave real é do Fable.

## O tema do momento (E55)

`npm run avaliar:tema-do-momento` mede o `temaDoMomento` (prompt novo no modelo forte): cada caso traz um setor e uma lista de assuntos em alta no Brasil, e diz se o código de produção deve gerar um tema do momento ou não (encaixe de pelo menos 7, assunto que existe, nunca sensível). O resumo imprime os acertos e, para cada tema gerado, o título e o porquê, para o revisor ler. O arquivo real é `GOLDEN_SET_DIR/tema-do-momento.json`; sem ele, roda com `tema-do-momento.exemplo.json`. Os casos do exemplo: tendência que cabe, que não cabe, sensível, ruído de futebol, reality e celular numa clínica, a escola de idiomas com o show de uma banda internacional (gera, adaptando), que cabe em parte e um serviço (clínica) com tendência de preço. `temas.exemplo.json` ganhou um caso de tema que toca um assunto em alta no Brasil (`tendenciasDoBrasil`).


## A edição de vídeo (E47 PR 3)

`npm run avaliar:edicao` roda a decisão da edição de ponta a ponta sobre a fala de um vídeo (sem banco e sem render): o modelo forte decide o que fica (por número de palavra), o motor de corte
calcula o plano e a legenda, o código e o verificador barato conferem. É o mesmo núcleo que o job `decidir-edicao` usa (`src/servicos/decidir-edicao-nucleo.ts`). As chamadas vão direto, a
preço cheio (a decisão tem dois passos que dependem um do outro, o lote não serve). O resumo imprime: edições verificadas, abertura certa (meta do PR 3: 4 de 5), legenda sem nome errado nem
palavra proibida, sem alerta de corte com palavra soando, o título de cada caso (para o Gustavo dizer se é igual à abertura do roteiro ou melhor), os tokens e o custo (teto de US$ 5 por dia).

O arquivo real é `GOLDEN_SET_DIR/edicao.json`; sem ele, roda com `edicao.exemplo.json`, três casos de fala sintética (palavras com tempo montadas de `frases`, com a curva de energia coerente):
duas tentativas da abertura mais um nome de marca que o transcritor ouve errado; três tentativas da abertura e a última é a boa; uma gravação limpa (caso de controle). Sob o simulador
(`AI_PROVIDER=mock`) o resultado NÃO mede o modelo.

Um caso:

```json
{
  "nome": "um nome curto",
  "marca": { "nome": "Dr.Wash", "cidade": "Campinas", "concorrentes": [], "resumo": "o briefing em poucas linhas" },
  "roteiro": { "titulo": "", "gancho": "", "corpo": "", "fechamento": "", "chamadaFinal": "", "textoNaTela": [] },
  "palavras": [{ "texto": "Oi", "inicio": 0.4, "fim": 0.6 }],
  "energia": { "db": [-60.1, -59.8], "duracao": 23.4 },
  "esperado": { "aberturaCerta": { "deIndice": 9, "ateIndice": 38 }, "legendaDeveConter": ["DR.WASH"], "legendaNaoPodeConter": ["UOSH"] },
  "pontoPrincipal": "por que este caso existe"
}
```

- Fala real (o golden set de verdade, depois que o Gustavo gravar os vídeos de referência, a fase 0 do estudo): `palavras` e `energia` vêm de uma edição que chegou a `transcrito` (`edicoes.palavras`
  e `edicoes.energia`), e `esperado.aberturaCerta` é a tentativa da abertura que ele aprovou na edição de referência (o que conta é a primeira palavra). Fala sintética (só no exemplo): `frases`
  (cada uma com `pausaAntes`) no lugar de `palavras` e `energia`, e `esperado.aberturaCertaFrase` (o número, de 1, da frase certa).
- Nada de fala de cliente ou de vídeo de verdade entra no repositório (ele é público): o arquivo real fica em `avaliacoes-privadas/`.
