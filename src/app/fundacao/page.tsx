"use client";

import {
  ArrowLeft,
  Bookmark,
  Check,
  CircleAlert,
  Copy,
  Ellipsis,
  ExternalLink,
  History,
  House,
  List,
  Music,
  Play,
  Scissors,
  Type,
  User,
  Video,
} from "lucide-react";
import { notFound } from "next/navigation";

import { AnaliseQuatroPartes } from "@/ui/componentes/AnaliseQuatroPartes";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraNotaGeral } from "@/ui/componentes/BarraNotaGeral";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao } from "@/ui/componentes/BlocoEdicao";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Cartao } from "@/ui/componentes/Cartao";
import { Chips, SeparadorChips } from "@/ui/componentes/Chips";
import { Constancia } from "@/ui/componentes/Constancia";
import { EstadoErro } from "@/ui/componentes/EstadoErro";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";
import { Nota } from "@/ui/componentes/Nota";
import { OpcaoObjetivo } from "@/ui/componentes/OpcaoObjetivo";
import { Pilares } from "@/ui/componentes/PilarLinha";
import { Progresso } from "@/ui/componentes/Progresso";
import { ReferenciaCartao } from "@/ui/componentes/ReferenciaCartao";
import { RoteiroTexto } from "@/ui/componentes/RoteiroTexto";
import { Skeleton } from "@/ui/componentes/Skeleton";
import { TemaCartao } from "@/ui/componentes/TemaCartao";
import { Logo } from "@/ui/Logo";

import { AlternarTema } from "./AlternarTema";
import { FundacaoInterativa } from "./FundacaoInterativa";
import styles from "./page.module.css";

const ICONES = [
  { Icone: House, nome: "casa" },
  { Icone: Video, nome: "vídeo" },
  { Icone: History, nome: "histórico" },
  { Icone: List, nome: "lista" },
  { Icone: User, nome: "pessoa" },
  { Icone: Bookmark, nome: "marcador" },
  { Icone: Copy, nome: "copiar" },
  { Icone: Play, nome: "tocar" },
  { Icone: Type, nome: "texto" },
  { Icone: Scissors, nome: "tesoura" },
  { Icone: Music, nome: "música" },
  { Icone: ExternalLink, nome: "link externo" },
  { Icone: CircleAlert, nome: "alerta" },
  { Icone: ArrowLeft, nome: "voltar" },
  { Icone: Check, nome: "check" },
  { Icone: Ellipsis, nome: "mais opções" },
];

/**
 * Todos os componentes em todos os estados, claro e escuro, no padrao de
 * FundacaoFolha.dc.html (decisao do Fable, PROXIMO.md, etapa D parte 1). So
 * em desenvolvimento: 404 em producao, e o que o Fable compara com o
 * artboard e o que a captura registra.
 */
export default function Fundacao() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <div className={styles.identidade}>
          <Logo tamanho={24} />
          <span>seu painel</span>
        </div>
        <AlternarTema />
      </header>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Botão</h2>
        <div className={styles.linha}>
          <Botao>Gerar roteiro</Botao>
          <Botao variante="secundario">Ver referências</Botao>
          <Botao variante="ghost">Pular por agora</Botao>
          <Botao variante="perigo">Apagar roteiro</Botao>
          <Botao disabled>Gerar roteiro</Botao>
          <Botao carregando>Gerar roteiro</Botao>
        </div>
        <div className={styles.coluna} style={{ maxWidth: 320 }}>
          <Botao tamanho="lg">Começar a gravar</Botao>
          <Botao tamanho="lg" carregando>
            Aguarde
          </Botao>
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Campo e área de texto</h2>
        <div className={styles.coluna} style={{ maxWidth: 400 }}>
          <Campo rotulo="Nome do negócio" defaultValue="Casa Limpa da Marina" contador="20/60" />
          <Campo rotulo="Seu e-mail" defaultValue="marina@casalimpa" erro="Falta a parte depois do ponto, como .com.br" />
          <Campo rotulo="Setor" defaultValue="Produtos de limpeza" disabled />
          <Campo rotulo="Instagram" placeholder="casalimpa" prefixo="@" />
          <AreaTexto
            rotulo="O que você vende e para quem?"
            ajuda="Escreva como você falaria para uma cliente."
            defaultValue="Produtos de limpeza que eu mesma faço, para quem quer casa cheirosa sem gastar muito."
            contador="86/200"
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Cartão</h2>
        <div className={styles.grade3}>
          <Cartao>
            <strong>Bastidor do estoque</strong>
            <p>Mostre como você embala um pedido, do começo ao fim.</p>
          </Cartao>
          <Cartao variante="recuado">
            <strong>Onde gravar</strong>
            <p>No estoque, com as caixas ao fundo. Luz da janela, celular na vertical.</p>
          </Cartao>
          <Cartao variante="destaque">
            <strong>Tema escolhido para hoje</strong>
            <p>O produto sendo usado numa cozinha de verdade.</p>
          </Cartao>
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Nota</h2>
        <div className={styles.linha}>
          <Nota valor={8.4} legenda="muito boa" />
          <Nota valor={6.5} legenda="no caminho" />
          <Nota valor={4.2} legenda="abaixo do esperado" />
        </div>
        <div style={{ maxWidth: 420, borderTop: "1px solid var(--cor-borda)" }}>
          <Nota tamanho="lista" valor={4.2} rotulo="Para quem você vende" legenda="abaixo do esperado" />
          <Nota tamanho="lista" valor={6.8} rotulo="Onde você grava" legenda="no caminho" />
          <Nota tamanho="lista" valor={8.4} rotulo="O que você vende" legenda="muito boa" />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Análise em quatro partes</h2>
        <div style={{ maxWidth: 480 }}>
          <AnaliseQuatroPartes
            avaliacao={{
              nota: 6.5,
              bom: "Você diz o que faz e para quem, sem rodeio.",
              melhorar: "A resposta serve para qualquer marca de limpeza. Falta o que só a sua tem.",
              como: "Troque o geral pelo concreto: um produto, um lugar, uma situação.",
              exemplo: "Faço produtos de limpeza na minha cozinha no Cambuí, em Campinas, para quem quer a casa cheirosa sem produto forte.",
              impacto: "Os roteiros conseguem citar o seu produto e o seu bairro em vez de falar de limpeza em geral.",
            }}
            rotulos={{ bom: "o que está bom", melhorar: "o que pode melhorar", como: "como melhorar", impacto: "impacto no seu resultado" }}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Barra de nota geral</h2>
        <div style={{ maxWidth: 360 }}>
          <BarraNotaGeral
            notaAtual={6.8}
            meta={8}
            rotuloNotaAtual="nota atual"
            rotuloMeta="meta 8"
            dica="a P5 é a que mais ajuda agora"
            semNota="sem nota"
            tituloFolha="as doze notas"
            notas={[
              { rotulo: "P1", nota: 6.5 },
              { rotulo: "P2", nota: 9.2 },
              { rotulo: "P3", nota: null },
            ]}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Pilares</h2>
        <div style={{ maxWidth: 480 }}>
          <Pilares
            pilares={[
              { nome: "chance de viralizar", valor: 7.2, porque: "o assunto está sendo assistido até o fim, mas com poucos vídeos" },
              { nome: "chance de gerar cliente", valor: 8.4, porque: "quem pergunta isso já está limpando e já compra produto" },
              { nome: "encaixe com você", valor: 9.1, porque: "é o seu produto de vidro, na sua bancada" },
              { nome: "novidade", valor: 6.0, porque: "muita gente já explicou o embaçado; falta o seu jeito" },
              { nome: "facilidade de gravar", valor: 8.3, porque: "dá para gravar na sua janela com o celular na mão" },
            ]}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Tema do dia</h2>
        <div style={{ maxWidth: 420 }}>
          <TemaCartao
            rotulo="para te chamarem"
            tema="o erro que quase todo mundo comete ao limpar o fogão"
            porque="Mostrar o erro e o jeito certo no mesmo take está segurando a atenção até o fim."
            evidencia="5 vídeos fora da curva esta semana"
            primario
            rotuloBotao="quero esse"
            onEscolher={() => undefined}
          />
        </div>
      </section>

      <FundacaoInterativa />

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Roteiro, cenas e edição</h2>
        <div className={styles.grade2} style={{ alignItems: "start" }}>
          <RoteiroTexto
            blocos={[
              { rotulo: "os 3 primeiros segundos", paragrafos: ["Se você limpa o fogão assim, está espalhando a gordura em vez de tirar."] },
              { rotulo: "o meio", paragrafos: ["Mostra o pano passando em círculo e a mancha se abrindo.", "Vira o pano, passa o produto em linha reta."] },
              { rotulo: "a chamada final", paragrafos: ["Se quiser o que eu uso, me chama aqui embaixo que eu mando."] },
            ]}
          />
          <div className={styles.coluna}>
            <BlocoCenas
              titulo="Onde gravar e o que mostrar"
              cenas={[
                { momento: "0 a 3 s", oQueFazer: "na sua cozinha, em frente ao fogão, com o pano na mão" },
                { momento: "3 a 25 s", oQueFazer: "câmera apoiada na bancada, mostrando só as mãos e o fogão" },
                { momento: "25 a 35 s", oQueFazer: "você de volta ao quadro, fogão limpo ao fundo" },
              ]}
            />
            <BlocoEdicao
              titulo="Como editar"
              itens={[
                { icone: Type, rotulo: "texto na tela", texto: "aos 0:03, uma direção só, em cima, curto" },
                { icone: Scissors, rotulo: "ritmo de corte", texto: "corte a cada 3 a 4 segundos" },
                { icone: Music, rotulo: "áudio da semana", texto: "baixo, atrás da sua voz", mono: "cozinha limpa, instrumental" },
              ]}
            />
          </div>
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Cartão de referência</h2>
        <div style={{ maxWidth: 340 }}>
          <ReferenciaCartao
            vezes="6,2x"
            rotuloVezes="acima do normal da conta"
            conta="@casaemordem"
            data="30 ago"
            analise={[
              { rotulo: "como começou", texto: "Abre com a mão já esfregando a mancha, sem falar por dois segundos." },
              { rotulo: "por que funcionou", texto: "Todo mundo se reconhece no erro e fica para ver o certo." },
            ]}
            embed={{
              url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              alt: "Vídeo de @casaemordem",
              rotuloCarregamento: "embed oficial 9:16",
              linkExterno: { rotulo: "abrir o vídeo", href: "https://www.youtube.com" },
            }}
            salvo={false}
            rotuloUsar="usar como referência"
            rotuloSalvar="salvar nos favoritos"
            rotuloSalvando="salvando"
            onSalvar={() => undefined}
            onUsar={() => undefined}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Constância</h2>
        <Constancia
          numeros={[
            { valor: "4", rotulo: "dias seguidos" },
            { valor: "9", rotulo: "gravados este mês" },
            { valor: "6", rotulo: "postados este mês" },
          ]}
          dias={[true, true, false, true, true, false, false, true, true, false, true, false]}
          rotuloDias="Últimos dias: gravou em 8 dias"
        />
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Chips</h2>
        <div className={styles.linha} style={{ alignItems: "center" }}>
          <Chips rotuloGrupo="Plataforma" opcoes={["todas", "YouTube", "TikTok", "Instagram"]} selecionado={1} onChange={() => undefined} />
          <SeparadorChips />
          <Chips rotuloGrupo="Período" opcoes={["esta semana", "30 dias", "90 dias"]} selecionado={0} onChange={() => undefined} />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Estado vazio e estado de erro</h2>
        <div className={styles.grade2}>
          <EstadoVazio
            icone={<Video size={24} strokeWidth={1.5} aria-hidden="true" />}
            frase="Seu primeiro roteiro aparece aqui depois que você escolher um tema do dia."
            acao={{ rotulo: "ver os temas de hoje", onClick: () => undefined }}
          />
          <EstadoErro
            frase="Não deu para ler os vídeos desta semana. Tente de novo em alguns segundos."
            acao={{ rotulo: "tentar de novo", onClick: () => undefined }}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Skeleton</h2>
        <div className={styles.coluna} style={{ maxWidth: 320 }}>
          <Skeleton variante="titulo" />
          <Skeleton variante="corpo" largura="100%" />
          <Skeleton variante="corpo" largura="94%" />
          <Skeleton variante="corpo" largura="62%" />
          <Skeleton variante="numero" />
        </div>
        <div style={{ maxWidth: 160, marginTop: "var(--espaco-4)" }}>
          <Skeleton variante="video" />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Progresso</h2>
        <Progresso rotulo="bloco 2 de 5" atual={2} total={5} />
        <div style={{ marginTop: "var(--espaco-4)" }}>
          <Progresso mensagem="lendo a sua resposta" />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Opção de objetivo</h2>
        <div role="radiogroup" aria-label="Objetivo do vídeo" className={styles.coluna} style={{ maxWidth: 420 }}>
          <OpcaoObjetivo
            titulo="Mais gente me conhecer"
            ajuda="para quem ainda não te viu"
            marcada={false}
            onEscolher={() => undefined}
          />
          <OpcaoObjetivo
            titulo="Gente me chamar para comprar"
            ajuda="para quem está quase decidindo"
            marcada
            recomendada
            rotuloRecomendado="Recomendado hoje"
            onEscolher={() => undefined}
          />
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Logo reservado, 24 px</h2>
        <div className={styles.linha} style={{ alignItems: "center" }}>
          <Logo tamanho={24} />
          <span className={styles.legendaIcone}>Círculo em linha. Troca pelo símbolo da marca quando ele existir.</span>
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.tituloSecao}>Ícones · Lucide · traço 1,5</h2>
        <div className={styles.grade6}>
          {ICONES.map(({ Icone, nome }) => (
            <div key={nome} className={styles.icone}>
              <Icone size={24} strokeWidth={1.5} aria-hidden="true" />
              <span className={styles.legendaIcone}>{nome}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
