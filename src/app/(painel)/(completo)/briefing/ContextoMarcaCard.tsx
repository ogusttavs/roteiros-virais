"use client";

import { Check, CircleAlert, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { fraseDaFonteNaoLida } from "@/lib/frase-fonte-contexto";
import type { ItemDaSecao, ItemTirado, SecaoContextoMarca } from "@/servicos/contexto-marca";
import { limparTextoDaPessoa, TAMANHO_MAXIMO_TEXTO_DA_PESSOA } from "@/servicos/contexto-marca-regras";
import { textosBriefing } from "@/textos/briefing";
import { Botao } from "@/ui/componentes/Botao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import cartaoStyles from "@/ui/componentes/Cartao.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

// O erro em linha do briefing (ícone e cor de erro), o mesmo das respostas e do cartão do aprendizado.
import perguntaStyles from "../../_briefing/PerguntaCampo.module.css";

import {
  confirmarItemContextoAction,
  corrigirItemContextoAction,
  desfazerTirarItemContextoAction,
  tirarItemContextoAction,
} from "./acoes";
import styles from "./ContextoMarcaCard.module.css";

const t = textosBriefing.contextoDaMarca;

type Props = { secao: SecaoContextoMarca };

/** O item na tela: igual ao do servidor, mais o `recusado` local (tirado, com "Desfazer" até a página recarregar). */
type ItemLocal = Omit<ItemDaSecao, "estado"> & {
  estado: ItemDaSecao["estado"] | "recusado";
  /** O estado de antes de tirar, para o "Desfazer" devolver o que era. */
  anterior?: ItemDaSecao["estado"];
};

/** Resultado da ação no servidor: `"mudou"` quando a proposta trocou enquanto a página estava aberta. */
type ResultadoDaAcao = void | "confirmado" | "mudou";

/** O id do botão de um item, para devolver o foco a ele depois de uma ação (os botões não aceitam `ref`). */
const idDoBotao = (id: number, acao: "corrigir" | "desfazer" | "estaCerto" | "tirar") => `contexto-${id}-${acao}`;

/**
 * "O que a IA tirou das suas redes e do seu site" (E38 PR 2, desenho do Opus, `Briefing.dc.html`,
 * estado `contextoDaMarca`): o que a IA leu do site e das redes da pessoa, separado do que ela
 * respondeu, e que ela confirma ("Está certo"), corrige no próprio lugar ou tira. Só o que ela
 * confirma ou corrige chega aos roteiros (`perfilDoCliente`). Otimista com volta, como o
 * `AprendizadoCard`: a linha muda na hora e desfaz se a ação falhar, com a frase embaixo dela.
 *
 * Quando o servidor traz outra leitura (`router.refresh`: o botão de atualizar do celular, ou a própria
 * ação que descobriu que a proposta mudou), `secao.versao` muda e a lista local recomeça dela, em vez de
 * ficar com a de antes (o padrão de "ajustar o estado durante a renderização", sem efeito). As frases de
 * erro e o campo de correção aberto continuam: a pessoa não perde o que escrevia nem a frase que explica.
 *
 * Montado com as peças existentes onde o desenho não cobre (regra 11): os estados sem fonte, lendo e
 * "não deu", o "Tirar" com "Desfazer" inline e a lista dos itens tirados, "Corrigido por você", "o que
 * continua valendo" por cima de uma proposta nova, e o microfone no campo de correção (regra A1: todo
 * campo de texto livre que a IA lê aceita fala). Registrado para o Opus.
 */
export function ContextoMarcaCard({ secao }: Props) {
  const router = useRouter();
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  const [itens, setItens] = useState<ItemLocal[]>(secao.itens);
  const [versaoDaSecao, setVersaoDaSecao] = useState(secao.versao);
  if (versaoDaSecao !== secao.versao) {
    setVersaoDaSecao(secao.versao);
    setItens(secao.itens);
  }
  const tirados: ItemTirado[] = secao.tirados;
  const [editando, setEditando] = useState<{ id: number; texto: string } | null>(null);
  /** Um Set de ids, não um id só (a lição do V7 no `AprendizadoCard`). */
  const [idsPendentes, setIdsPendentes] = useState<ReadonlySet<number>>(() => new Set());
  const [erros, setErros] = useState<Record<number, string>>({});
  /**
   * A última coisa que a pessoa fez, dita por voz a quem usa leitor de tela (a linha muda e o foco fica onde estava). O contador
   * vira a `key` do texto: a mesma frase duas vezes seguidas ("Item confirmado." de novo) só é lida de novo se o nó for outro.
   */
  const [anuncio, setAnuncio] = useState({ frase: "", n: 0 });
  const anunciar = (frase: string) => setAnuncio((atual) => ({ frase, n: atual.n + 1 }));
  /** O id do botão que deve receber o foco depois da próxima renderização. */
  const [foco, setFoco] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const idEditando = editando?.id ?? null;
  const [, iniciarTransicao] = useTransition();

  // O alvo do foco pode ainda não existir (a seção vem de novo do servidor depois de "Desfazer" na lista dos tirados): espera ele aparecer.
  useEffect(() => {
    if (!foco) return;
    const alvo = document.getElementById(foco);
    if (alvo) {
      alvo.focus();
      setFoco(null);
    }
  }, [foco, itens]);

  /** Qual correção está aberta agora, para uma ação que termina depois saber se o campo que ela prometia guardar ainda existe. */
  const idEditandoRef = useRef<number | null>(null);
  useEffect(() => {
    idEditandoRef.current = idEditando;
  });

  // Abrir a correção leva o foco para o campo; sem isso, quem usa teclado ou leitor de tela fica no botão que sumiu.
  useEffect(() => {
    if (idEditando !== null) areaRef.current?.focus();
  }, [idEditando]);

  function marcarPendente(id: number, pendente: boolean) {
    setIdsPendentes((atual) => {
      const proximo = new Set(atual);
      if (pendente) proximo.add(id);
      else proximo.delete(id);
      return proximo;
    });
  }

  function definirErro(id: number, frase: string | null) {
    setErros((atual) => {
      const proximo = { ...atual };
      if (frase === null) delete proximo[id];
      else proximo[id] = frase;
      return proximo;
    });
  }

  function trocar(id: number, mudar: (item: ItemLocal) => ItemLocal) {
    setItens((atual) => atual.map((item) => (item.id === id ? mudar(item) : item)));
  }

  /** Muda a linha na hora, chama o servidor, e devolve a linha ao que era (com a frase) se a ação falhar. */
  function agir(
    id: number,
    otimista: (item: ItemLocal) => ItemLocal,
    acao: () => Promise<ResultadoDaAcao>,
    frases: { erro: string; semConexao: string; feito: string },
    alvoDoFoco: { depois: string; seFalhar: string },
  ) {
    const original = itens.find((item) => item.id === id);
    if (!original) return;
    trocar(id, otimista);
    definirErro(id, null);
    marcarPendente(id, true);
    iniciarTransicao(async () => {
      try {
        const resultado = await acao();
        if (resultado === "mudou") {
          // Outra leitura trocou a proposta: volta a linha, avisa, e busca a seção nova (o `key` recomeça o cartão dela).
          trocar(id, () => original);
          definirErro(id, t.mudouEnquantoLia);
          setFoco(alvoDoFoco.seFalhar);
          router.refresh();
          return;
        }
        avisarRedeOk();
        anunciar(frases.feito);
        setFoco(alvoDoFoco.depois);
      } catch (falha) {
        trocar(id, () => original);
        definirErro(id, tratarFalha(falha, frases.erro, frases.semConexao));
        setFoco(alvoDoFoco.seFalhar);
      } finally {
        marcarPendente(id, false);
      }
    });
  }

  function confirmar(id: number) {
    const item = itens.find((candidato) => candidato.id === id);
    if (!item) return;
    agir(
      id,
      (atual) => ({ ...atual, estado: "confirmado", valiaAntes: null, novidade: null }),
      // A pessoa confirma o texto que está vendo: o servidor recusa se a proposta já trocou.
      () => confirmarItemContextoAction(id, item.texto),
      { erro: t.erroConfirmar, semConexao: t.semConexaoConfirmar, feito: t.anuncioConfirmado },
      { depois: idDoBotao(id, "corrigir"), seFalhar: idDoBotao(id, "estaCerto") },
    );
  }

  function tirar(id: number) {
    if (editando?.id === id) setEditando(null);
    agir(
      id,
      (item) => ({ ...item, anterior: item.estado === "recusado" ? item.anterior : item.estado, estado: "recusado", novidade: null }),
      () => tirarItemContextoAction(id),
      { erro: t.erroTirar, semConexao: t.semConexaoTirar, feito: t.anuncioTirado },
      { depois: idDoBotao(id, "desfazer"), seFalhar: idDoBotao(id, "tirar") },
    );
  }

  function desfazer(id: number) {
    agir(
      id,
      (item) => ({ ...item, estado: item.anterior ?? "para_confirmar", anterior: undefined }),
      () => desfazerTirarItemContextoAction(id),
      { erro: t.erroDesfazer, semConexao: t.semConexaoDesfazer, feito: t.anuncioDesfeito },
      { depois: idDoBotao(id, "corrigir"), seFalhar: idDoBotao(id, "desfazer") },
    );
  }

  /** Desfazer de um item tirado antes de a página recarregar: a lista de tirados vem do servidor, então a seção recomeça dele. */
  function desfazerDaLista(id: number) {
    definirErro(id, null);
    marcarPendente(id, true);
    iniciarTransicao(async () => {
      try {
        await desfazerTirarItemContextoAction(id);
        avisarRedeOk();
        anunciar(t.anuncioDesfeito);
        // O botão sai da lista quando a seção vem de novo: o foco vai para o item que voltou (o efeito espera ele aparecer).
        setFoco(idDoBotao(id, "corrigir"));
        router.refresh();
      } catch (falha) {
        definirErro(id, tratarFalha(falha, t.erroDesfazer, t.semConexaoDesfazer));
        setFoco(idDoBotao(id, "desfazer"));
      } finally {
        marcarPendente(id, false);
      }
    });
  }

  function salvarCorrecao() {
    if (!editando) return;
    const { id } = editando;
    const texto = limparTextoDaPessoa(editando.texto);
    if (texto === "") {
      definirErro(id, t.textoObrigatorio);
      return;
    }
    if (texto.length > TAMANHO_MAXIMO_TEXTO_DA_PESSOA) {
      definirErro(id, t.textoLongo(TAMANHO_MAXIMO_TEXTO_DA_PESSOA));
      return;
    }
    definirErro(id, null);
    marcarPendente(id, true);
    iniciarTransicao(async () => {
      try {
        await corrigirItemContextoAction(id, texto);
        trocar(id, (item) => ({ ...item, estado: "corrigido", texto, valiaAntes: null, novidade: null }));
        // Só fecha o editor deste item: a pessoa pode ter aberto o de outro enquanto este salvava.
        setEditando((atual) => (atual?.id === id ? null : atual));
        avisarRedeOk();
        anunciar(t.anuncioCorrigido);
        setFoco(idDoBotao(id, "corrigir"));
      } catch (falha) {
        // O que a pessoa escreveu continua no campo (nada se perde), a não ser que ela já tenha aberto a correção de outro item:
        // aí o campo daquele item foi trocado, e a frase não promete o que já não existe.
        const campoAindaAberto = idEditandoRef.current === id;
        definirErro(
          id,
          tratarFalha(
            falha,
            campoAindaAberto ? t.erroCorrigir : t.erroCorrigirSemTexto,
            campoAindaAberto ? t.semConexaoCorrigir : t.semConexaoCorrigirSemTexto,
          ),
        );
      } finally {
        marcarPendente(id, false);
      }
    });
  }

  const fontesLidas = secao.fontes.filter((f) => f.lida && f.tipo !== "tiktok").map((f) => f.tipo as "site" | "instagram" | "youtube");
  const frasesDasFontesNaoLidas = secao.fontes.map(fraseDaFonteNaoLida).filter((frase): frase is string => frase !== null);
  const bloqueadoPelaRede = semConexao;
  const temItens = itens.length > 0;
  const mostrarFrasesDasFontes = frasesDasFontesNaoLidas.length > 0 && secao.estado !== "sem_fonte" && secao.estado !== "lendo";

  return (
    <section
      id="contexto-marca"
      className={[cartaoStyles.cartao, cartaoStyles.recuado, styles.cartao].join(" ")}
      aria-label={t.titulo}
      data-passo="contextoDaMarca"
    >
      <div>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        {temItens ? <p className={styles.subtitulo}>{t.abertura}</p> : null}
        {secao.ultimaLeituraOkEm && fontesLidas.length > 0 ? (
          <p className={styles.lidoEm}>{t.lidoEm(secao.ultimaLeituraOkEm, fontesLidas, secao.proximaLeituraEm)}</p>
        ) : null}
      </div>

      {/* Dito por voz a quem usa leitor de tela: a linha muda no lugar e o foco continua onde estava. */}
      <p className={styles.somenteLeitorDeTela} role="status" aria-live="polite">
        <span key={anuncio.n}>{anuncio.frase}</span>
      </p>

      {secao.estado === "sem_fonte" ? (
        <div className={styles.corpoEstado}>
          <p className={styles.vazio}>{t.semFonte}</p>
          <Link href="/conta" className={styles.link}>
            {t.irParaConta}
          </Link>
        </div>
      ) : null}

      {secao.estado === "lendo" ? <p className={styles.vazio}>{t.lendo}</p> : null}

      {secao.estado === "nao_leu" ? <p className={styles.vazio}>{t.naoLeu}</p> : null}

      {secao.estado === "ok" && !temItens ? <p className={styles.vazio}>{tirados.length > 0 ? t.nadaSobrou : t.nadaClaro}</p> : null}

      {temItens ? (
        <ul className={styles.itens}>
          {itens.map((item) => {
            const pendente = idsPendentes.has(item.id);
            const edicao = editando?.id === item.id ? editando : null;
            const tirado = item.estado === "recusado";
            return (
              <li key={item.id} className={styles.item} data-estado={item.estado}>
                {!tirado && item.novidade ? (
                  <span className={styles.marcaNovidade}>
                    <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                    {item.novidade === "alem_do_briefing"
                      ? t.novidadeAlemDoBriefing
                      : item.novidade === "mudou"
                        ? t.novidadeMudou
                        : t.novidade}
                  </span>
                ) : null}
                <span className={styles.deOndeVeio}>{t.origem[item.origem]}</span>

                {edicao ? (
                  <>
                    <CampoComFala
                      ref={areaRef}
                      rotulo={t.campoCorrigir}
                      rotuloOculto
                      ajuda={t.campoCorrigirAjuda}
                      contador={t.contadorCorrecao(limparTextoDaPessoa(edicao.texto).length, TAMANHO_MAXIMO_TEXTO_DA_PESSOA)}
                      erro={erros[item.id]}
                      value={edicao.texto}
                      onChange={(texto) => setEditando((atual) => (atual?.id === item.id ? { id: item.id, texto } : atual))}
                      nomeArquivo="contexto-marca.webm"
                      disabled={pendente}
                    />
                    <div className={styles.acoesItem}>
                      <Botao type="button" onClick={salvarCorrecao} carregando={pendente} disabled={pendente || bloqueadoPelaRede}>
                        {t.salvar}
                      </Botao>
                      <Botao
                        type="button"
                        variante="ghost"
                        onClick={() => {
                          setEditando(null);
                          definirErro(item.id, null);
                          setFoco(idDoBotao(item.id, "corrigir"));
                        }}
                        disabled={pendente}
                      >
                        {t.cancelar}
                      </Botao>
                    </div>
                  </>
                ) : tirado ? (
                  <>
                    <p className={[styles.oQue, styles.oQueTirado].join(" ")}>{item.texto}</p>
                    <div className={styles.acoesItem}>
                      <span className={styles.tiradoAviso}>{t.tirado}</span>
                      <Botao
                        id={idDoBotao(item.id, "desfazer")}
                        type="button"
                        variante="ghost"
                        aria-label={t.rotuloDaAcao(t.desfazer, item.texto)}
                        onClick={() => desfazer(item.id)}
                        disabled={pendente || bloqueadoPelaRede}
                      >
                        {t.desfazer}
                      </Botao>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.oQue}>{item.texto}</p>
                    {item.valiaAntes ? (
                      <p className={styles.valiaAntes}>
                        <span>{t.valiaAntes}</span> {item.valiaAntes}
                      </p>
                    ) : null}
                    <div className={styles.acoesItem}>
                      {item.estado === "para_confirmar" ? (
                        <Botao
                          id={idDoBotao(item.id, "estaCerto")}
                          type="button"
                          variante="secundario"
                          aria-label={t.rotuloDaAcao(t.estaCerto, item.texto)}
                          onClick={() => confirmar(item.id)}
                          disabled={pendente || bloqueadoPelaRede}
                        >
                          {t.estaCerto}
                        </Botao>
                      ) : (
                        <span className={styles.confirmado}>
                          <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                          {item.estado === "corrigido" ? t.corrigido : t.confirmado}
                        </span>
                      )}
                      <Botao
                        id={idDoBotao(item.id, "corrigir")}
                        type="button"
                        variante="ghost"
                        aria-label={t.rotuloDaAcao(t.corrigir, item.texto)}
                        onClick={() => {
                          // Abrir o editor deste item fecha o de outro: o erro do outro ("o que você escreveu continua aí") deixa de ser verdade.
                          if (editando && editando.id !== item.id) definirErro(editando.id, null);
                          definirErro(item.id, null);
                          setEditando({ id: item.id, texto: item.texto });
                        }}
                        disabled={pendente || bloqueadoPelaRede}
                      >
                        {t.corrigir}
                      </Botao>
                      <Botao
                        id={idDoBotao(item.id, "tirar")}
                        type="button"
                        variante="ghost"
                        aria-label={t.rotuloDaAcao(t.tirar, item.texto)}
                        onClick={() => tirar(item.id)}
                        disabled={pendente || bloqueadoPelaRede}
                      >
                        {t.tirar}
                      </Botao>
                    </div>
                  </>
                )}

                {/* Sem conexão os botões ficam desabilitados: o motivo escrito, uma vez por linha. */}
                <MotivoSemRede className={styles.lidoEm} />
                {/* Na correção, o erro é do próprio campo (liga ao campo por `aria-describedby`); fora dela, aqui embaixo. */}
                {!edicao && erros[item.id] ? (
                  <span role="alert">
                    <span className={perguntaStyles.erroInline}>
                      <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                      {erros[item.id]}
                    </span>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {tirados.length > 0 ? (
        <details className={styles.tirados}>
          <summary className={styles.tiradosResumo}>{t.tiradosTitulo(tirados.length)}</summary>
          <p className={styles.lidoEm}>{t.tiradosAjuda}</p>
          <ul className={styles.itens}>
            {tirados.map((item) => {
              const pendente = idsPendentes.has(item.id);
              return (
                <li key={item.id} className={styles.item}>
                  <span className={styles.deOndeVeio}>{t.origem[item.origem]}</span>
                  <p className={[styles.oQue, styles.oQueTirado].join(" ")}>{item.texto}</p>
                  <div className={styles.acoesItem}>
                    <Botao
                      id={idDoBotao(item.id, "desfazer")}
                      type="button"
                      variante="ghost"
                      aria-label={t.rotuloDaAcao(t.desfazer, item.texto)}
                      onClick={() => desfazerDaLista(item.id)}
                      carregando={pendente}
                      disabled={pendente || bloqueadoPelaRede}
                    >
                      {t.desfazer}
                    </Botao>
                  </div>
                  {erros[item.id] ? (
                    <span role="alert">
                      <span className={perguntaStyles.erroInline}>
                        <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                        {erros[item.id]}
                      </span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {mostrarFrasesDasFontes ? (
        <ul className={styles.fontesNaoLidas}>
          {frasesDasFontesNaoLidas.map((frase) => (
            <li key={frase}>{frase}</li>
          ))}
        </ul>
      ) : null}

      {secao.tiktokGuardado ? <p className={styles.lidoEm}>{t.tiktokGuardado}</p> : null}
    </section>
  );
}
