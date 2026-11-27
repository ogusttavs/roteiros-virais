/**
 * E65 PR 2: o CSS dos modelos de slide do carrossel, tirado do desenho (`entregaveis/design-v2/entrega/carrossel/slides.css`, 25/11/2026) sem mudar nenhuma regra visual. Tudo nasce de `--marca`
 * e do modo (`data-modo`: claro, escuro ou marca); a tinta sobre a cor cheia (`--sobre-marca`) é calculada por código, nunca escolhida. O slide é do cliente: nada do aplicativo (nome, logotipo, letra do
 * painel) entra aqui. As letras (Mona Sans e JetBrains Mono, as duas SIL OFL 1.1) são declaradas em `modelos.ts`, lidas do disco em `src/ui/fontes`. O tamanho é fixo, 1080 por 1350.
 */
export const ESTILO_DOS_SLIDES = `

.slide {
  /* A cor de exemplo, para o modelo abrir sozinho. O código sempre sobrescreve. */
  --marca: #0e5a6a;
  --sobre-marca: #ffffff;

  /* A escala, em três níveis e o @. Cada um com o seu piso (README, "Quando o texto não cabe"). */
  --s-capa: 104px;       --s-capa-min: 84px;
  --s-titulo: 68px;      --s-titulo-min: 56px;
  --s-corpo: 40px;       --s-corpo-min: 34px;
  --s-rotulo: 28px;
  --s-fonte: 30px;

  --s-margem: 96px;
  --s-raio: 32px;

  position: relative;
  width: 1080px;
  height: 1350px;
  box-sizing: border-box;
  overflow: hidden;
  isolation: isolate;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 48px;
  padding: 88px var(--s-margem) 72px;
  background: var(--s-fundo);
  color: var(--s-texto);
  font-family: "Mona Sans", "Segoe UI", Roboto, sans-serif;
  font-stretch: 100%;
  font-size: var(--s-corpo);
  line-height: 1.34;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  /* Dentro de um botão do painel (a miniatura), nada do botão vaza para o slide. */
  text-align: left; letter-spacing: normal; white-space: normal; cursor: inherit;
}
.slide *, .slide *::before, .slide *::after { box-sizing: border-box; }
.slide p, .slide h1, .slide h2, .slide h3, .slide ul, .slide ol, .slide figure, .slide blockquote { margin: 0; padding: 0; }
.slide ul, .slide ol { list-style: none; }
/* Dentro do painel (a tela Criar carrossel), os títulos do painel não vazam para o slide:
   a família e a largura voltam a ser as do slide. Especificidade baixa de propósito. */
:where(.slide) :where(h1, h2, h3, p, blockquote, figcaption) { font-family: inherit; font-stretch: inherit; }

/* ---------- Os três modos, todos a partir de --marca ----------
   claro: o fundo é a marca quase sumida no papel; a tinta é preta puxada para a marca.
   escuro: o fundo é a marca afundada no preto; a tinta é branca.
   marca: a cor cheia, com a tinta que der mais contraste.
   A ordem dos modos num carrossel alterna; nunca três iguais seguidos. */
.slide[data-modo="claro"] {
  --s-fundo: color-mix(in oklab, var(--marca) 6%, #fbfaf7);
  --s-placa: color-mix(in oklab, var(--marca) 11%, #ffffff);
  --s-titulo-cor: color-mix(in oklab, var(--marca) 30%, #0c0c0e);
  --s-texto: color-mix(in oklab, var(--marca) 16%, #2a2a2f);
  --s-suave: color-mix(in oklab, var(--marca) 20%, #55555c);
  --s-acento: color-mix(in oklab, var(--marca) 88%, #000000);
  --s-linha: color-mix(in oklab, var(--marca) 24%, transparent);
  --s-cheio: var(--marca);
  --s-sobre-cheio: var(--sobre-marca);
}
.slide[data-modo="escuro"] {
  --s-fundo: color-mix(in oklab, var(--marca) 22%, #0a0b0c);
  --s-placa: color-mix(in oklab, var(--marca) 30%, #16181b);
  --s-titulo-cor: #fbfbfa;
  --s-texto: color-mix(in oklab, var(--marca) 10%, #e6e6e8);
  --s-suave: color-mix(in oklab, var(--marca) 16%, #b9b9bf);
  --s-acento: color-mix(in oklab, var(--marca) 52%, #ffffff);
  --s-linha: color-mix(in oklab, #ffffff 20%, transparent);
  --s-cheio: color-mix(in oklab, var(--marca) 52%, #ffffff);
  --s-sobre-cheio: color-mix(in oklab, var(--marca) 30%, #0c0c0e);
}
.slide[data-modo="marca"] {
  --s-fundo: var(--marca);
  --s-placa: color-mix(in oklab, var(--sobre-marca) 12%, var(--marca));
  --s-titulo-cor: var(--sobre-marca);
  --s-texto: color-mix(in oklab, var(--sobre-marca) 90%, var(--marca));
  --s-suave: color-mix(in oklab, var(--sobre-marca) 78%, var(--marca));
  --s-acento: var(--sobre-marca);
  --s-linha: color-mix(in oklab, var(--sobre-marca) 32%, transparent);
  --s-cheio: var(--sobre-marca);
  --s-sobre-cheio: var(--marca);
}
/* Foto ocupando o slide: a tinta é sempre branca sobre a proteção escura,
   qualquer que seja o modo. */
.slide.foto-cheia {
  --s-titulo-cor: #ffffff;
  --s-texto: rgba(255, 255, 255, .92);
  --s-suave: rgba(255, 255, 255, .84);
  --s-acento: #ffffff;
  --s-linha: rgba(255, 255, 255, .34);
  background: #1a1a1a;
}

/* ---------- As peças fixas: o rótulo no alto, o @ e o progresso no pé ---------- */
.s-topo { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 56px; position: relative; z-index: 2; }
.s-rotulo {
  display: inline-flex; align-items: center; gap: 16px;
  min-height: 56px; padding: 0 24px;
  border: 3px solid var(--s-linha); border-radius: 999px;
  font: 600 var(--s-rotulo)/1 "JetBrains Mono", Consolas, monospace;
  letter-spacing: .08em; text-transform: uppercase;
  color: var(--s-titulo-cor);
}
.s-rotulo::before { content: ""; width: 14px; height: 14px; border-radius: 50%; background: var(--s-acento); }
.s-topo .s-data { font: 500 var(--s-rotulo)/1 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); letter-spacing: .02em; }

.s-pe { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 40px; position: relative; z-index: 2; }
.s-arroba { font: 600 var(--s-rotulo)/1 "JetBrains Mono", Consolas, monospace; color: var(--s-titulo-cor); letter-spacing: .01em; }
/* O progresso: um traço curto por slide; o de agora na cor de acento e mais
   longo, os que já passaram em meio-tom, os que faltam só o contorno da linha.
   Discreto de propósito: diz "tem mais" sem disputar com o texto. */
.s-progresso { display: flex; align-items: center; gap: 8px; }
.s-progresso i { display: block; width: 22px; height: 8px; border-radius: 8px; background: var(--s-linha); }
.s-progresso i.feito { background: color-mix(in oklab, var(--s-acento) 50%, transparent); }
.s-progresso i.agora { width: 56px; background: var(--s-acento); }

/* ---------- O corpo e os três níveis ---------- */
.s-corpo { position: relative; z-index: 2; min-height: 0; display: flex; flex-direction: column; gap: 36px; }
.s-corpo.na-base { justify-content: flex-end; }
.s-titulo-capa { font-size: var(--s-capa); line-height: 1.02; font-weight: 850; letter-spacing: -0.035em; color: var(--s-titulo-cor); text-wrap: balance; }
.s-titulo { font-size: var(--s-titulo); line-height: 1.08; font-weight: 800; letter-spacing: -0.028em; color: var(--s-titulo-cor); text-wrap: balance; }
.s-texto { font-size: var(--s-corpo); line-height: 1.36; font-weight: 450; color: var(--s-texto); text-wrap: pretty; max-width: 860px; }
.s-texto strong { font-weight: 700; color: var(--s-titulo-cor); }
/* Um passo abaixo, o único permitido antes de quebrar o slide (README). */
.ajustado .s-titulo-capa { font-size: var(--s-capa-min); }
.ajustado .s-titulo { font-size: var(--s-titulo-min); }
.ajustado .s-texto { font-size: var(--s-corpo-min); }

/* ---------- A foto do cliente ----------
   No produto é um <img> com object-fit: cover e o ponto de foco que a pessoa
   marca (object-position). Aqui, o bloco neutro que diz o que entraria. */
.s-foto {
  position: relative; overflow: hidden;
  display: grid; place-items: center; align-content: center; gap: 12px;
  background: repeating-linear-gradient(135deg, #cbc7c0 0 3px, #d8d4ce 3px 26px);
  color: #4d4a45; text-align: center;
  font: 600 30px/1.3 "JetBrains Mono", Consolas, monospace;
  border-radius: var(--s-raio);
}
.s-foto b { font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.s-foto span { max-width: 80%; font-weight: 500; font-size: 26px; opacity: .9; }
.s-foto img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.slide.foto-cheia .s-foto.fundo { position: absolute; inset: 0; z-index: 0; border-radius: 0; align-content: start; padding-top: 340px; }
/* A proteção do título: escurece a metade de baixo em degradê. Medida para o
   branco passar de 4,5:1 sobre a parte mais clara que uma foto pode ter (o
   branco puro): na altura do título o véu já está em 78%. */
.slide.foto-cheia::after {
  content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(0,0,0,var(--prot-extra,0)) 0, rgba(0,0,0,0) 360px),
    linear-gradient(rgba(0,0,0,calc(var(--prot-extra,0) * .5)), rgba(0,0,0,calc(var(--prot-extra,0) * .5))),
    linear-gradient(180deg, rgba(0,0,0,.46) 0, rgba(0,0,0,0) 220px),
    linear-gradient(0deg, rgba(0,0,0,.86) 0, rgba(0,0,0,.78) 34%, rgba(0,0,0,.30) 62%, rgba(0,0,0,0) 78%);
}

/* ---------- Tipo: capa com foto ---------- */
.slide[data-tipo="capa-foto"] .s-sub { font-size: 44px; line-height: 1.3; font-weight: 500; color: var(--s-texto); max-width: 820px; }

/* ---------- Tipo: capa sem foto ---------- */
.slide[data-tipo="capa-texto"] .s-corpo { justify-content: center; gap: 44px; }
.slide[data-tipo="capa-texto"] .s-marcador { width: 168px; height: 22px; border-radius: 22px; background: var(--s-acento); }
.slide[data-tipo="capa-texto"] .s-titulo-capa { font-size: 116px; }
.slide[data-tipo="capa-texto"].ajustado .s-titulo-capa { font-size: var(--s-capa-min); }
.slide[data-tipo="capa-texto"] .s-sub { font-size: 44px; line-height: 1.3; font-weight: 500; color: var(--s-texto); max-width: 820px; }
.s-arraste { display: inline-flex; align-items: center; gap: 16px; align-self: flex-end; font: 600 var(--s-rotulo)/1 "JetBrains Mono", Consolas, monospace; letter-spacing: .06em; text-transform: uppercase; color: var(--s-titulo-cor); }
.s-arraste svg { width: 56px; height: 56px; }

/* ---------- Tipo: passo numerado ----------
   O número é o maior elemento do slide, na cor de acento, colado à margem. */
.slide[data-tipo="passo"] .s-corpo { gap: 32px; }
/* Sem foto: o número no alto e o texto assentado no pé, para o slide não ficar com um vão no meio. */
.slide[data-tipo="passo"]:not(.com-foto) .s-numero { margin-bottom: auto; }
.slide[data-tipo="passo"]:not(.com-foto) .s-titulo { font-size: 76px; }
.slide[data-tipo="passo"]:not(.com-foto).ajustado .s-titulo { font-size: var(--s-titulo-min); }
.s-numero {
  font: 900 340px/.78 "Mona Sans", sans-serif; font-stretch: 100%;
  letter-spacing: -0.06em; color: var(--s-acento);
  margin: 8px 0 28px -14px; font-variant-numeric: tabular-nums;
}
.slide[data-tipo="passo"].com-foto .s-foto { height: 560px; flex: 0 0 auto; }
.slide[data-tipo="passo"].com-foto .s-linha-passo { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 36px; align-items: start; }
.slide[data-tipo="passo"].com-foto .s-numero { font-size: 176px; margin: -6px 0 0 -6px; }

/* ---------- Tipo: item de lista ----------
   O traço grosso de acento segura o título; o índice fica no rótulo. */
.slide[data-tipo="item"] .s-corpo { justify-content: center; gap: 40px; }
.slide .s-com-traco { padding-left: 44px; border-left: 14px solid var(--s-acento); }
.slide[data-tipo="item"] .s-titulo { font-size: 76px; }
.slide[data-tipo="item"] .s-texto { padding-left: 58px; }
.slide[data-tipo="item"].ajustado .s-titulo { font-size: var(--s-titulo-min); }
.s-indice { font: 800 44px/1 "JetBrains Mono", Consolas, monospace; color: var(--s-acento); letter-spacing: -0.02em; }

/* ---------- Tipo: antes e depois ---------- */
.s-par { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; flex: 1 1 auto; min-height: 0; }
.s-lado { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 24px; min-height: 0; }
.s-lado .s-foto { min-height: 0; }
.s-lado figcaption { font-size: var(--s-corpo-min); line-height: 1.3; color: var(--s-texto); }
.s-etiqueta {
  position: absolute; top: 24px; left: 24px; z-index: 1;
  display: inline-flex; align-items: center; min-height: 52px; padding: 0 24px; border-radius: 999px;
  font: 700 26px/1 "JetBrains Mono", Consolas, monospace; letter-spacing: .08em; text-transform: uppercase;
  background: #ffffff; color: #111111;
}
.s-lado.depois .s-etiqueta { background: var(--marca); color: var(--sobre-marca); }
/* Sem foto: dois blocos de texto, o "depois" na cor cheia. */
.s-pilha { display: grid; gap: 28px; flex: 1 1 auto; align-content: center; }
.s-bloco { display: grid; gap: 16px; padding: 44px 48px; border-radius: var(--s-raio); background: var(--s-placa); }
.s-bloco .s-qual { font: 700 26px/1 "JetBrains Mono", Consolas, monospace; letter-spacing: .1em; text-transform: uppercase; color: var(--s-suave); }
.s-bloco p { font-size: 44px; line-height: 1.28; font-weight: 600; color: var(--s-titulo-cor); }
.s-bloco.depois { background: var(--s-cheio); }
.s-bloco.depois .s-qual { color: color-mix(in oklab, var(--s-sobre-cheio) 80%, var(--s-cheio)); }
.s-bloco.depois p { color: var(--s-sobre-cheio); }

/* ---------- Tipo: dado ----------
   O número sozinho não entra: sem fonte e ano o slide não existe. */
.slide[data-tipo="dado"] .s-corpo { justify-content: center; gap: 28px; }
.s-valor { font: 900 300px/.86 "Mona Sans", sans-serif; letter-spacing: -0.055em; color: var(--s-acento); margin-left: -10px; white-space: nowrap; }
.s-valor small { font-size: .42em; letter-spacing: -0.03em; margin-left: .2em; }
.slide[data-tipo="dado"] .s-frase { font-size: 52px; line-height: 1.2; font-weight: 650; letter-spacing: -0.015em; color: var(--s-titulo-cor); max-width: 880px; text-wrap: balance; }
.s-fonte { display: grid; gap: 8px; padding-top: 28px; margin-top: 20px; border-top: 3px solid var(--s-linha); font: 500 var(--s-fonte)/1.35 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); }
.s-fonte b { font-weight: 700; color: var(--s-texto); }

/* ---------- Tipo: prova ---------- */
.slide[data-tipo="prova-fala"] .s-corpo { justify-content: center; gap: 36px; }
.s-aspas { font: 900 260px/.6 "Mona Sans", sans-serif; color: var(--s-acento); height: 130px; margin-left: -8px; }
.s-citacao { font-size: 60px; line-height: 1.2; font-weight: 650; letter-spacing: -0.02em; color: var(--s-titulo-cor); text-wrap: pretty; }
.s-quem { display: grid; gap: 8px; font: 500 var(--s-fonte)/1.3 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); }
.s-quem b { font-weight: 700; color: var(--s-texto); }
.slide[data-tipo="prova-resultado"] .s-corpo { gap: 32px; }
.slide[data-tipo="prova-resultado"] .s-foto { flex: 1 1 auto; min-height: 0; }
.s-autorizacao { font: 500 26px/1.3 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); }

/* ---------- Tipo: resumo ---------- */
.slide[data-tipo="resumo"] .s-corpo { justify-content: center; gap: 44px; }
.s-lista { display: grid; }
.s-lista li { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 32px; align-items: start; padding: 32px 0; border-top: 3px solid var(--s-linha); font-size: 46px; line-height: 1.22; font-weight: 650; color: var(--s-titulo-cor); letter-spacing: -0.01em; }
.s-lista li:last-child { border-bottom: 3px solid var(--s-linha); }
.s-lista .s-check { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 18px; background: var(--s-cheio); color: var(--s-sobre-cheio); margin-top: -4px; }
.s-lista .s-check svg { width: 38px; height: 38px; }

/* ---------- Tipo: chamada final ---------- */
.slide[data-tipo="chamada"] .s-corpo { justify-content: center; gap: 44px; }
.slide[data-tipo="chamada"] .s-titulo-capa { font-size: 96px; }
.slide[data-tipo="chamada"].ajustado .s-titulo-capa { font-size: var(--s-capa-min); }
.s-arroba-grande {
  align-self: flex-start; display: inline-flex; align-items: center; min-height: 104px; padding: 0 44px;
  border-radius: 999px; background: var(--s-cheio); color: var(--s-sobre-cheio);
  font: 700 50px/1 "JetBrains Mono", Consolas, monospace; letter-spacing: -0.01em;
}
.s-acoes { display: flex; flex-wrap: wrap; gap: 20px 40px; }
.s-acao { display: inline-flex; align-items: center; gap: 16px; font: 600 var(--s-rotulo)/1.2 "JetBrains Mono", Consolas, monospace; letter-spacing: .04em; text-transform: uppercase; color: var(--s-titulo-cor); }
.s-acao svg { width: 44px; height: 44px; flex: 0 0 auto; }

/* ---------- Tipo: capa de notícia (E66) ----------
   Uma imagem só. Escuro: a foto ocupa o slide. Claro: a foto em cima, de borda
   a borda, e o texto no papel. A fonte e a data são obrigatórias e ficam no
   alto e no pé, onde não somem num recorte. */
.slide[data-tipo="noticia"] .s-titulo-capa { font-size: 92px; line-height: 1.04; }
.slide[data-tipo="noticia"].ajustado .s-titulo-capa { font-size: 80px; }

/* A foto em cima, de borda a borda, e o texto no papel: a capa com foto e a
   capa de notícia no modo claro. Ordem no HTML: foto, topo, corpo, pé. */
.slide.foto-topo { grid-template-rows: 620px auto minmax(0, 1fr) auto; padding-top: 0; gap: 36px; }
.slide.foto-topo .s-foto.topo { margin: 0 calc(var(--s-margem) * -1); border-radius: 0; }
.slide.foto-topo .s-foto.topo.cor-cheia { background: var(--marca); }
.slide.foto-topo .s-corpo { justify-content: flex-start; gap: 24px; }
.slide.foto-topo .s-titulo-capa { font-size: 84px; line-height: 1.04; }
.slide.foto-topo.ajustado .s-titulo-capa { font-size: 72px; }
.s-de-onde { font: 500 var(--s-fonte)/1.35 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); }
.s-de-onde b { font-weight: 700; color: var(--s-texto); }

/* ---------- Os fundos abstratos (canvas de sexta, 25/11/2026) ----------
   So nos slides de texto, nunca no lugar de foto: o desenho abstrato tingido pela cor da marca (modo de mistura "cor") e, POR CIMA, um veu da cor do fundo do modo, que segura o contraste do texto
   no pior pixel que o fundo pode ter (o teste confere). A imagem entra inline em cada slide (modelos.ts, fundoDoSlide). */
.slide.fundo {
  background-size: cover;
  background-position: center;
}

/* ---------- A ilustracao por slide (E69) ----------
   A imagem de fundo e as camadas de veu entram inline em cada slide (modelos.ts). No estilo leve ha um painel arredondado com a cor do modo atras do bloco de texto; a margem negativa e o
   preenchimento iguais deixam o texto na mesma coluna de sempre, e a altura maxima do painel e a da caixa do corpo, entao a regra de "precisa encurtar" continua valendo. */
.slide.veu-leve .s-corpo { align-self: center; max-height: 100%; padding: 48px 28px; margin: 0 -28px; border-radius: 36px; background: color-mix(in srgb, var(--s-fundo) var(--painel, 93%), transparent); }
.s-ilustrativa { font: 600 22px/1 "JetBrains Mono", Consolas, monospace; letter-spacing: .04em; color: var(--s-titulo-cor); text-align: center; }

/* ---------- Responsavel tecnica (a linha vem da Conta; vazia, nao se desenha) ---------- */
.s-resp { font: 500 24px/1.3 "JetBrains Mono", Consolas, monospace; color: var(--s-suave); }
`;
