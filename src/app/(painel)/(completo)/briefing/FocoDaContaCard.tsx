"use client";

import { Check, CircleAlert } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import type { FocoParaATela } from "@/servicos/foco-da-conta";
import { textosBriefing } from "@/textos/briefing";
import { Botao } from "@/ui/componentes/Botao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

// O erro em linha do briefing (ícone e cor de erro), o mesmo das respostas e dos outros cartões.
import perguntaStyles from "../../_briefing/PerguntaCampo.module.css";

import { confirmarFocoAction, escreverFocoAction, sugerirFocoAction, tirarFocoAction, type ResultadoFoco } from "./acoes";
import styles from "./FocoDaContaCard.module.css";

const t = textosBriefing.focoDaConta;

/** O mesmo teto do servidor (`TAMANHO_MAXIMO_DO_FOCO`); repetido aqui porque o serviço importa o banco e este arquivo roda no navegador. */
const MAXIMO = 300;

type Props = { inicial: FocoParaATela };

type Pendencia = "sugerir" | "confirmar" | "salvar" | "tirar";

/**
 * "O foco da sua conta" (E61 PR 1): a pergunta "Dentro do seu setor, sobre o que você fala e para quem?" com três estados. Sem foco (a pessoa escreve, ou pede uma sugestão), sugerido (a pessoa
 * confirma com "Está certo", corrige, pede outro ou tira) e confirmado (corrige ou tira). Só o confirmado chega aos roteiros, e a tela diz isso. A tela mostra o que o servidor devolve em cada ação,
 * nunca o que ela supõe: o foco que não gravou não aparece como gravado.
 */
export function FocoDaContaCard({ inicial }: Props) {
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [foco, setFoco] = useState<FocoParaATela>(inicial);
  /** O texto no campo quando a pessoa está escrevendo; `null` fora da edição. */
  const [editando, setEditando] = useState<string | null>(null);
  const [pendente, setPendente] = useState<Pendencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState({ frase: "", n: 0 });
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [, iniciarTransicao] = useTransition();

  const anunciar = (frase: string) => setAnuncio((atual) => ({ frase, n: atual.n + 1 }));
  const ocupado = pendente !== null;
  const bloqueado = ocupado || semConexao;

  /** Chama a ação, mostra o foco que o servidor devolveu e, se não deu, a frase do motivo. */
  function agir(
    qual: Pendencia,
    acao: () => Promise<ResultadoFoco>,
    frases: { erro: string; semConexao: string; feito: string },
    aoDarCerto?: () => void,
  ) {
    setErro(null);
    setPendente(qual);
    iniciarTransicao(async () => {
      try {
        const resultado = await acao();
        setFoco(resultado.foco);
        avisarRedeOk();
        if (resultado.ok) {
          aoDarCerto?.();
          anunciar(frases.feito);
        } else {
          setErro(resultado.erro);
        }
      } catch (falha) {
        setErro(tratarFalha(falha, frases.erro, frases.semConexao));
      } finally {
        setPendente(null);
      }
    });
  }

  function sugerir() {
    agir("sugerir", () => sugerirFocoAction(), { erro: t.erroSugerir, semConexao: t.semConexaoSugerir, feito: t.anuncioSugerido });
  }

  function confirmar() {
    if (foco.estado !== "sugerido") return;
    // A pessoa confirma o texto que está vendo: o servidor recusa se a sugestão já é outra.
    agir("confirmar", () => confirmarFocoAction(foco.texto), { erro: t.erroConfirmar, semConexao: t.semConexaoConfirmar, feito: t.anuncioConfirmado });
  }

  function salvar() {
    if (editando === null) return;
    agir("salvar", () => escreverFocoAction(editando), { erro: t.erroSalvar, semConexao: t.semConexaoSalvar, feito: t.anuncioSalvo }, () => setEditando(null));
  }

  function tirar() {
    agir("tirar", () => tirarFocoAction(), { erro: t.erroTirar, semConexao: t.semConexaoTirar, feito: t.anuncioTirado }, () => setEditando(null));
  }

  function abrirEdicao() {
    setErro(null);
    setEditando(foco.estado === "sem" ? "" : foco.texto);
    // O campo só existe depois da próxima renderização.
    setTimeout(() => areaRef.current?.focus(), 0);
  }

  function cancelarEdicao() {
    setEditando(null);
    setErro(null);
  }

  const usados = editando === null ? 0 : editando.replace(/\s+/g, " ").trim().length;

  return (
    <section
      id="foco-da-conta"
      className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")}
      aria-label={t.titulo}
      data-passo="focoDaConta"
      data-estado={foco.estado}
    >
      <div>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.pergunta}>{t.pergunta}</p>
        <p className={styles.ajuda}>{t.ajuda}</p>
      </div>

      {/* Dito por voz a quem usa leitor de tela: o cartão muda no lugar. */}
      <p className={styles.somenteLeitorDeTela} role="status" aria-live="polite">
        <span key={anuncio.n}>{anuncio.frase}</span>
      </p>

      {editando !== null ? (
        <>
          <CampoComFala
            ref={areaRef}
            rotulo={t.campo}
            rotuloOculto
            ajuda={t.exemplo}
            contador={t.contador(usados, MAXIMO)}
            placeholder={t.campoMarcador}
            value={editando}
            onChange={setEditando}
            nomeArquivo="foco-da-conta.webm"
            disabled={ocupado}
          />
          <div className={styles.acoes}>
            <Botao type="button" onClick={salvar} carregando={pendente === "salvar"} disabled={bloqueado}>
              {t.salvar}
            </Botao>
            <Botao type="button" variante="ghost" onClick={cancelarEdicao} disabled={ocupado}>
              {t.cancelar}
            </Botao>
          </div>
        </>
      ) : foco.estado === "sem" ? (
        <div className={styles.corpo}>
          <p className={styles.dica}>{t.semFoco}</p>
          <p className={styles.dica}>{t.exemplo}</p>
          <div className={styles.acoes}>
            <Botao type="button" variante="secundario" onClick={sugerir} carregando={pendente === "sugerir"} disabled={bloqueado}>
              {pendente === "sugerir" ? t.sugerindo : t.sugerir}
            </Botao>
            <Botao type="button" variante="ghost" onClick={abrirEdicao} disabled={bloqueado}>
              {t.escreverEu}
            </Botao>
          </div>
        </div>
      ) : foco.estado === "sugerido" ? (
        <div className={styles.corpo}>
          <span className={styles.rotulo}>{t.sugestaoTitulo}</span>
          <p className={styles.foco}>{foco.texto}</p>
          <p className={styles.dica}>{t.sugestaoAviso}</p>
          <div className={styles.acoes}>
            <Botao type="button" variante="secundario" onClick={confirmar} carregando={pendente === "confirmar"} disabled={bloqueado}>
              {t.estaCerto}
            </Botao>
            <Botao type="button" variante="ghost" onClick={abrirEdicao} disabled={bloqueado}>
              {t.corrigir}
            </Botao>
            <Botao type="button" variante="ghost" onClick={sugerir} carregando={pendente === "sugerir"} disabled={bloqueado}>
              {pendente === "sugerir" ? t.sugerindo : t.sugerirOutro}
            </Botao>
            <Botao type="button" variante="ghost" onClick={tirar} disabled={bloqueado}>
              {t.tirar}
            </Botao>
          </div>
        </div>
      ) : (
        <div className={styles.corpo}>
          <p className={styles.foco}>{foco.texto}</p>
          <span className={styles.confirmado}>
            <Check size={16} strokeWidth={1.75} aria-hidden="true" />
            {foco.origem === "escrito" ? t.escritoPorVoce : t.confirmadoPorVoce}
          </span>
          <p className={styles.dica}>{t.confirmadoAviso}</p>
          <div className={styles.acoes}>
            <Botao type="button" variante="ghost" onClick={abrirEdicao} disabled={bloqueado}>
              {t.corrigir}
            </Botao>
            <Botao type="button" variante="ghost" onClick={tirar} disabled={bloqueado}>
              {t.tirar}
            </Botao>
          </div>
        </div>
      )}

      {/* Sem conexão os botões ficam desligados: o motivo escrito, uma vez. */}
      <MotivoSemRede className={styles.dica} />
      {erro ? (
        <span role="alert">
          <span className={perguntaStyles.erroInline}>
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {erro}
          </span>
        </span>
      ) : null}
    </section>
  );
}
