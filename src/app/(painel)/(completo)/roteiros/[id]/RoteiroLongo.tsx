"use client";

import { Copy, Pencil } from "lucide-react";
import { useState } from "react";

import type { CapituloDoRoteiro, ConteudoRoteiro } from "@/db/schema";
import { capitulosParaCopiar, iniciosDosCapitulos, tempoNaTela } from "@/lib/capitulos-do-roteiro";
import { ganchosDosCapitulos, marcadoParaOsParagrafos, paragrafosMarcados, type MarcasParaATela } from "@/lib/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { FalaMarcada } from "@/ui/componentes/FalaMarcada";

import styles from "./RoteiroLongo.module.css";

/** O que a tela manda ao salvar um capítulo: o servidor refaz o texto corrido a partir dos capítulos (`editarRoteiro`). */
export type EdicaoDoCapitulo = { gancho?: string; chamadaFinal?: string; ganchoParaOProximo?: string; pontos: string[] };

type Props = {
  corpo: ConteudoRoteiro;
  /** "Ver como" só olha: sem o botão de editar. */
  somenteLeitura: boolean;
  semConexao: boolean;
  /** As marcas de fala, quando a chave está ligada e elas existem; só as frases ditas como estão escritas (o gancho do vídeo, a de cada capítulo e a chamada) as levam, os pontos nunca. */
  marcas?: MarcasParaATela | null;
  /** Salva um capítulo; devolve a frase de falha, ou nulo quando salvou. */
  salvar: (indice: number, edicao: EdicaoDoCapitulo) => Promise<string | null>;
};

const QUEBRA = String.fromCharCode(10);

/** O roteiro do vídeo longo do YouTube (E52, PR 4b, passo 25): a lista de capítulos para colar na descrição e um cartão por capítulo, cada um editável sozinho. */
export function RoteiroLongo({ corpo, somenteLeitura, semConexao, marcas = null, salvar }: Props) {
  const capitulos = corpo.capitulos ?? [];
  const inicios = iniciosDosCapitulos(capitulos);
  // Cada marcado só vale se o texto sem as marcas é o texto que a tela mostra (a trava, repetida na hora de desenhar).
  const ganchos = ganchosDosCapitulos(corpo);
  const marcadosDosCapitulos = marcadoParaOsParagrafos(
    ganchos.map((g) => g.texto),
    paragrafosMarcados(marcas, "corpo"),
  );
  const marcadoDoGancho = marcadoParaOsParagrafos([(corpo.gancho ?? "").trim()], paragrafosMarcados(marcas, "gancho"))?.[0] ?? null;
  const marcadoDaChamada = marcadoParaOsParagrafos([(corpo.chamadaFinal ?? "").trim()], paragrafosMarcados(marcas, "chamadaFinal"))?.[0] ?? null;
  const [copiado, setCopiado] = useState<"sim" | "erro" | null>(null);
  const [editando, setEditando] = useState<number | null>(null);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(capitulosParaCopiar(capitulos));
      setCopiado("sim");
    } catch {
      setCopiado("erro");
    }
  }

  return (
    <div className={styles.raiz} data-roteiro-longo>
      <section className={styles.indice} aria-labelledby="t-capitulos" data-indice-de-capitulos>
        <h2 id="t-capitulos">{textosRoteiro.capitulos.indiceTitulo}</h2>
        <p className={styles.ajuda}>{textosRoteiro.capitulos.indiceAjuda}</p>
        <ol>
          {capitulos.map((c, i) => (
            <li key={i}>
              <b>{tempoNaTela(inicios[i])}</b>
              <span>{c.nome}</span>
            </li>
          ))}
        </ol>
        <button type="button" className={styles.botaoVazio} onClick={() => void copiar()} data-copiar-capitulos>
          <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.capitulos.copiarCapitulos}
        </button>
        <span role="status" className={styles.status}>
          {copiado === "sim" ? textosRoteiro.capitulos.copiado : copiado === "erro" ? textosRoteiro.capitulos.erroCopiar : ""}
        </span>
      </section>

      {capitulos.map((c, i) => (
        <CartaoDoCapitulo
          key={i}
          indice={i}
          capitulo={c}
          inicioS={inicios[i]}
          ehOPrimeiro={i === 0}
          ehOUltimo={i === capitulos.length - 1}
          gancho={corpo.gancho}
          chamadaFinal={corpo.chamadaFinal}
          marcadoDoGancho={marcadoDoGancho}
          marcadoDaChamada={marcadoDaChamada}
          marcadoDoCapitulo={marcadosDosCapitulos ? (marcadosDosCapitulos[ganchos.findIndex((g) => g.indice === i)] ?? null) : null}
          editando={editando === i}
          podeEditar={!somenteLeitura && editando === null}
          semConexao={semConexao}
          aoEditar={() => setEditando(i)}
          aoFechar={() => setEditando(null)}
          salvar={salvar}
        />
      ))}
    </div>
  );
}

type PropsDoCartao = {
  indice: number;
  capitulo: CapituloDoRoteiro;
  inicioS: number;
  ehOPrimeiro: boolean;
  ehOUltimo: boolean;
  gancho: string;
  chamadaFinal: string;
  /** As mesmas frases com as marcas de fala, ou nulo (chave desligada, sem marcas, ou texto que mudou). */
  marcadoDoGancho: string | null;
  marcadoDaChamada: string | null;
  marcadoDoCapitulo: string | null;
  editando: boolean;
  podeEditar: boolean;
  semConexao: boolean;
  aoEditar: () => void;
  aoFechar: () => void;
  salvar: Props["salvar"];
};

function CartaoDoCapitulo({ indice, capitulo, inicioS, ehOPrimeiro, ehOUltimo, gancho, chamadaFinal, marcadoDoGancho, marcadoDaChamada, marcadoDoCapitulo, editando, podeEditar, semConexao, aoEditar, aoFechar, salvar }: PropsDoCartao) {
  const idTitulo = `cap-${indice + 1}`;
  const [rascunho, setRascunho] = useState({ gancho, chamadaFinal, ganchoParaOProximo: capitulo.ganchoParaOProximo ?? "", pontos: capitulo.pontos.join(QUEBRA) });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    setRascunho({ gancho, chamadaFinal, ganchoParaOProximo: capitulo.ganchoParaOProximo ?? "", pontos: capitulo.pontos.join(QUEBRA) });
    setErro(null);
    aoEditar();
  }

  async function guardar() {
    if (salvando || semConexao) return;
    setSalvando(true);
    setErro(null);
    const pontos = rascunho.pontos
      .split(QUEBRA)
      .map((p) => p.trim())
      .filter(Boolean);
    // Nenhum ponto sobrando: a frase certa aparece aqui mesmo (o servidor também recusa, mas a exceção dele chega à tela como a frase genérica).
    if (pontos.length === 0) {
      setSalvando(false);
      setErro(textosRoteiro.editando.pontosDoCapitulo(8));
      return;
    }
    const falha = await salvar(indice, {
      pontos,
      ...(ehOPrimeiro ? { gancho: rascunho.gancho } : {}),
      ...(ehOUltimo ? { chamadaFinal: rascunho.chamadaFinal } : { ganchoParaOProximo: rascunho.ganchoParaOProximo }),
    });
    setSalvando(false);
    if (falha) setErro(falha);
    else aoFechar();
  }

  return (
    <section className={styles.capitulo} aria-labelledby={idTitulo} data-capitulo={indice + 1}>
      <div className={styles.cabeca}>
        <span className={styles.tempo}>{textosRoteiro.capitulos.capitulo(indice + 1, tempoNaTela(inicioS), tempoNaTela(inicioS + capitulo.duracaoS))}</span>
        <h3 id={idTitulo}>{capitulo.nome}</h3>
        {podeEditar ? (
          <button type="button" className={styles.botaoTexto} onClick={abrir} aria-label={textosRoteiro.capitulos.editarCapitulo(capitulo.nome)} data-editar-capitulo>
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
            {textosRoteiro.editar}
          </button>
        ) : null}
      </div>

      {editando ? (
        <div className={styles.edicao}>
          {ehOPrimeiro ? <AreaTexto rotulo={textosRoteiro.capitulos.ganchoDoVideo} value={rascunho.gancho} onChange={(e) => setRascunho((r) => ({ ...r, gancho: e.target.value }))} /> : null}
          {ehOUltimo ? (
            <AreaTexto rotulo={textosRoteiro.capitulos.chamada} value={rascunho.chamadaFinal} onChange={(e) => setRascunho((r) => ({ ...r, chamadaFinal: e.target.value }))} />
          ) : (
            <AreaTexto rotulo={textosRoteiro.capitulos.ganchoParaOProximo} value={rascunho.ganchoParaOProximo} onChange={(e) => setRascunho((r) => ({ ...r, ganchoParaOProximo: e.target.value }))} />
          )}
          <AreaTexto rotulo={textosRoteiro.capitulos.pontosRotulo} value={rascunho.pontos} linhasMin={5} onChange={(e) => setRascunho((r) => ({ ...r, pontos: e.target.value }))} />
          {erro ? (
            <p role="alert" className={styles.erro}>
              {erro}
            </p>
          ) : null}
          <div className={styles.acoes}>
            <button type="button" className={styles.botao} onClick={() => void guardar()} disabled={salvando || semConexao} aria-busy={salvando || undefined}>
              {salvando ? textosRoteiro.editando.salvando : textosRoteiro.capitulos.salvarCapitulo}
            </button>
            <button type="button" className={styles.botaoVazio} onClick={aoFechar} disabled={salvando}>
              {textosRoteiro.editando.cancelar}
            </button>
          </div>
        </div>
      ) : (
        <dl>
          {ehOPrimeiro ? (
            <div>
              <dt>{textosRoteiro.capitulos.ganchoDoVideo}</dt>
              <dd className={styles.gancho}>{marcadoDoGancho ? <FalaMarcada marcado={marcadoDoGancho} /> : gancho}</dd>
            </div>
          ) : null}
          {capitulo.ganchoParaOProximo ? (
            <div>
              <dt>{textosRoteiro.capitulos.ganchoParaOProximo}</dt>
              <dd className={styles.gancho}>{marcadoDoCapitulo ? <FalaMarcada marcado={marcadoDoCapitulo} /> : capitulo.ganchoParaOProximo}</dd>
            </div>
          ) : null}
          {ehOUltimo && chamadaFinal.trim() ? (
            <div>
              <dt>{textosRoteiro.capitulos.chamada}</dt>
              <dd className={styles.gancho}>{marcadoDaChamada ? <FalaMarcada marcado={marcadoDaChamada} /> : chamadaFinal}</dd>
            </div>
          ) : null}
          <div>
            <dt>{textosRoteiro.capitulos.oQueFalarEMostrar}</dt>
            <dd>
              <ul className={styles.pontos}>
                {capitulo.pontos.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
              {capitulo.naImagem ? (
                <p className={styles.naImagem}>
                  <b>{textosRoteiro.capitulos.naImagem}:</b> {capitulo.naImagem}
                </p>
              ) : null}
            </dd>
          </div>
          {capitulo.comoEditar ? (
            <div>
              <dt>{textosRoteiro.capitulos.comoEditarCapitulo}</dt>
              <dd>{capitulo.comoEditar}</dd>
            </div>
          ) : null}
        </dl>
      )}
    </section>
  );
}
