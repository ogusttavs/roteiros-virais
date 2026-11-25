"use client";

import { CircleAlert } from "lucide-react";
import { useId, useState } from "react";

import { LISTAS_DO_TIPO, limiteDoCampo, type ChaveDeCampo, type SlideDoCarrossel } from "@/config/carrossel";
import { camposEditaveis, contarPalavras, excessoDoCampo } from "@/carrossel/regras";
import { textosCarrossel as t } from "@/textos/carrossel";
import { Botao } from "@/ui/componentes/Botao";
import { Folha } from "@/ui/componentes/Folha";

import estilos from "./CarrosselTela.module.css";
import { ErroDaRota, pedir, type CarrosselDaTela } from "./tipos";

/** Os campos que pedem uma caixa maior (texto corrido); os outros são uma linha. */
const CAMPOS_LONGOS = new Set<ChaveDeCampo>(["sub", "texto", "antes", "depois", "frase", "citacao"]);

type Props = {
  aoFechar: () => void;
  carrosselId: number;
  indice: number;
  slide: SlideDoCarrossel;
  /** O slide leva foto: os limites de passo e de antes e depois são os menores. */
  comFoto: boolean;
  aoSalvar: (carrossel: CarrosselDaTela) => void;
};

function valorInicial(slide: SlideDoCarrossel, chave: ChaveDeCampo): string {
  const v = slide[chave as keyof SlideDoCarrossel];
  return typeof v === "string" ? v : "";
}

function CampoDeTexto({ chave, valor, erro, contagem, aoMudar }: { chave: ChaveDeCampo; valor: string; erro: string | null; contagem: string; aoMudar: (v: string) => void }) {
  const id = useId();
  const longo = CAMPOS_LONGOS.has(chave);
  return (
    <div className={`${estilos.campoLinha} ${erro ? estilos.comErro : ""}`}>
      <label htmlFor={id}>{t.campos[chave]}</label>
      {longo ? <textarea id={id} value={valor} aria-invalid={Boolean(erro)} onChange={(e) => aoMudar(e.target.value)} /> : <input id={id} type="text" value={valor} aria-invalid={Boolean(erro)} onChange={(e) => aoMudar(e.target.value)} />}
      <span className={estilos.contagem}>
        {erro ? (
          <span className={estilos.erroCampo} role="alert">
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {erro}
          </span>
        ) : (
          <span />
        )}
        <b>{contagem}</b>
      </span>
    </div>
  );
}

/**
 * A folha "Trocar o texto do slide N": um campo por pedaço do slide (os do tipo, na ordem do desenho), cada um com a conta de palavras e o limite. Passou do limite, o campo mostra quanto passou e o
 * botão fica parado até caber (o servidor confere de novo). Salvar refaz o slide.
 */
export function FolhaTrocarTexto({ aoFechar, carrosselId, indice, slide, comFoto, aoSalvar }: Props) {
  const chaves = camposEditaveis(slide.tipo);
  const lista = LISTAS_DO_TIPO[slide.tipo];
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(chaves.map((c) => [c, valorInicial(slide, c)])));
  const [itens, setItens] = useState<string[]>(() => (lista ? Array.from({ length: Math.max(lista.minimo, (slide[lista.chave] ?? []).length) }, (_, i) => (slide[lista.chave] ?? [])[i] ?? "") : []));
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  function avisoDoCampo(chave: ChaveDeCampo): { erro: string | null; contagem: string } {
    const limite = limiteDoCampo(slide.tipo, chave, comFoto);
    const valor = valores[chave] ?? "";
    const excesso = excessoDoCampo(slide.tipo, chave, valor, comFoto);
    const porPalavras = (limite?.palavras ?? 0) > 1;
    const contagem = porPalavras ? t.contagem(contarPalavras(valor), limite?.palavras ?? 0) : t.contagemCaracteres(valor.trim().length, limite?.caracteres ?? 0);
    if (!excesso) return { erro: null, contagem };
    if (excesso.tipo === "vazio") return { erro: t.campoVazio, contagem };
    return { erro: excesso.tipo === "palavras" ? t.passou(excesso.n) : t.passouCaracteres(excesso.n), contagem };
  }

  const erroDaLista = (k: number): string | null => {
    if (!lista) return null;
    const v = itens[k] ?? "";
    if (!v.trim()) return t.campoVazio;
    const palavras = contarPalavras(v);
    if (palavras > lista.palavras) return t.passou(palavras - lista.palavras);
    if (v.trim().length > lista.caracteres) return t.passouCaracteres(v.trim().length - lista.caracteres);
    return null;
  };

  const temErro = chaves.some((c) => avisoDoCampo(c).erro) || itens.some((_, k) => erroDaLista(k));

  async function salvar() {
    if (temErro || salvando) return;
    setSalvando(true);
    setFalha(null);
    try {
      const { carrossel } = await pedir<{ carrossel: CarrosselDaTela }>(
        `/api/carrossel/${carrosselId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ indice, campos: valores, ...(lista ? { listas: { [lista.chave]: itens } } : {}) }) },
        t.falhouAoSalvar,
      );
      aoSalvar(carrossel);
    } catch (e) {
      setFalha(e instanceof ErroDaRota ? e.message : t.falhouAoSalvar);
      setSalvando(false);
    }
  }

  return (
    <Folha
      titulo={t.trocarTextoTitulo(indice + 1)}
      aberto
      aoFechar={aoFechar}
      rodape={
        <div className={estilos.folhaPe}>
          <Botao type="button" onClick={() => void salvar()} disabled={temErro || salvando} carregando={salvando}>
            {salvando ? t.refazendo : t.refazer}
          </Botao>
          <button type="button" className={estilos.textoBotao} style={{ justifySelf: "center", marginLeft: 0 }} onClick={aoFechar}>
            {t.cancelar}
          </button>
        </div>
      }
    >
      <div className={estilos.folhaCorpo}>
        <p>{t.trocarTextoAjuda(t.nomeDoTipo[slide.tipo] ?? slide.tipo)}</p>
        {chaves.map((chave) => {
          const { erro, contagem } = avisoDoCampo(chave);
          return <CampoDeTexto key={chave} chave={chave} valor={valores[chave] ?? ""} erro={erro} contagem={contagem} aoMudar={(v) => setValores((a) => ({ ...a, [chave]: v }))} />;
        })}
        {lista
          ? itens.map((item, k) => {
              const erro = erroDaLista(k);
              const palavras = contarPalavras(item);
              return (
                <div key={k} className={`${estilos.campoLinha} ${erro ? estilos.comErro : ""}`}>
                  <label htmlFor={`lista-${k}`}>{lista.chave === "linhas" ? t.linhaN(k + 1) : t.acaoN(k + 1)}</label>
                  <input id={`lista-${k}`} type="text" value={item} aria-invalid={Boolean(erro)} onChange={(e) => setItens((a) => a.map((x, i) => (i === k ? e.target.value : x)))} />
                  <span className={estilos.contagem}>
                    {erro ? (
                      <span className={estilos.erroCampo} role="alert">
                        <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                        {erro}
                      </span>
                    ) : (
                      <span />
                    )}
                    <b>{t.contagem(palavras, lista.palavras)}</b>
                  </span>
                </div>
              );
            })
          : null}
        {falha ? (
          <p className={estilos.erroCampo} role="alert">
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {falha}
          </p>
        ) : null}
      </div>
    </Folha>
  );
}
