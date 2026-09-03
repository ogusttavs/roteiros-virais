# Conjuntos de referência (golden sets)

Para saber se uma mudança de prompt ou de modelo melhorou ou piorou, o produto compara a nota
que a IA dá com a nota que o Gustavo daria (`estrategia/briefing-e-rubricas.md`, seção 8).

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
