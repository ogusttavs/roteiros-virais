"use client";

import { CircleAlert, Info } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";

import { textosNoticias } from "@/textos/noticias";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Folha } from "@/ui/componentes/Folha";

import { acrescentarAssuntoAction, manterAssuntoAction, tirarAssuntoAction, type ResultadoAssunto } from "./acoes";
import styles from "./NoticiasTela.module.css";

export type AssuntoNaFolha = { id: number; texto: string; termos: string[]; fixado: boolean; diasSemAbrir: number; saiEmDias: number | null };

const MAXIMO = 5;

type Props = {
  aberto: boolean;
  aoFechar: () => void;
  assuntos: AssuntoNaFolha[];
  /** O "ver como" só olha: nada aqui muda o que é da pessoa. */
  somenteLeitura: boolean;
  /** O assunto que acabou de entrar: a tela de trás diz quando as notícias dele chegam. */
  aoAcrescentar: (assunto: string) => void;
};

/**
 * A folha "Os assuntos que você acompanha" (E53, passo 20): até cinco por marca, cada um com as palavras que ajudam a achar, "Tirar" e, no que está perto de sair sozinho (20 dias sem a pessoa
 * abrir uma notícia dele), o aviso com "Manter". Embaixo, "Acrescentar um assunto". No celular sobe do pé; do tablet para cima é o painel no meio (o `Folha` já faz as duas).
 */
export function FolhaDosAssuntos({ aberto, aoFechar, assuntos, somenteLeitura, aoAcrescentar }: Props) {
  const [texto, setTexto] = useState("");
  const [palavras, setPalavras] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const cheio = assuntos.length >= MAXIMO;

  function executar(tarefa: () => Promise<ResultadoAssunto>, aoDarCerto?: () => void) {
    setErro(null);
    iniciar(async () => {
      try {
        const resultado = await tarefa();
        if (!resultado.ok) {
          setErro(resultado.erro);
          return;
        }
        aoDarCerto?.();
      } catch {
        setErro(textosNoticias.erroAssunto);
      }
    });
  }

  function acrescentar(evento: FormEvent) {
    evento.preventDefault();
    const assunto = texto.trim();
    executar(() => acrescentarAssuntoAction(assunto, palavras), () => {
      setTexto("");
      setPalavras("");
      aoAcrescentar(assunto);
    });
  }

  return (
    <Folha
      titulo={textosNoticias.folhaTitulo}
      aberto={aberto}
      aoFechar={aoFechar}
      rodape={
        <div className={styles.rodapeFolha}>
          <Botao variante="secundario" tamanho="lg" onClick={aoFechar}>
            {textosNoticias.pronto}
          </Botao>
        </div>
      }
    >
      <div className={styles.corpoAssuntos} data-folha-assuntos>
        <p className={styles.explica}>{textosNoticias.folhaAjuda(assuntos.length)}</p>
        {somenteLeitura ? <p className={styles.explica}>{textosNoticias.verComoDesligado}</p> : null}

        {assuntos.length > 0 ? (
          <ul className={styles.listaAssuntos}>
            {assuntos.map((a) => (
              <li key={a.id} className={styles.assunto} data-assunto={a.id}>
                <div className={styles.sobreAssunto}>
                  <b>{a.texto}</b>
                  {a.termos.length > 0 ? (
                    <span className={styles.termos}>
                      {a.termos.map((t) => (
                        <span key={t} className={styles.termo}>
                          {t}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {a.saiEmDias !== null ? (
                    <span className={styles.avisoParado}>
                      <CircleAlert aria-hidden="true" strokeWidth={1.75} />
                      {textosNoticias.semNoticiaAberta(a.diasSemAbrir, a.saiEmDias)}
                    </span>
                  ) : null}
                  {a.fixado ? <span className={styles.mantido}>{textosNoticias.mantido}</span> : null}
                </div>
                <div className={styles.acoesAssunto}>
                  {a.saiEmDias !== null ? (
                    <Botao variante="secundario" tamanho="md" disabled={ocupado || somenteLeitura} aria-label={textosNoticias.manterAssunto(a.texto)} onClick={() => executar(() => manterAssuntoAction(a.id))}>
                      {textosNoticias.manter}
                    </Botao>
                  ) : null}
                  <Botao variante="ghost" tamanho="md" disabled={ocupado || somenteLeitura} aria-label={textosNoticias.tirarAssunto(a.texto)} onClick={() => executar(() => tirarAssuntoAction(a.id))}>
                    {textosNoticias.tirar}
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <form className={styles.novoAssunto} onSubmit={acrescentar}>
          <h3>{textosNoticias.acrescentarTitulo}</h3>
          <Campo rotulo={textosNoticias.campoAssunto} value={texto} maxLength={60} disabled={cheio || somenteLeitura} onChange={(e) => setTexto(e.target.value)} />
          <Campo rotulo={textosNoticias.campoPalavras} ajuda={textosNoticias.ajudaPalavras} value={palavras} disabled={cheio || somenteLeitura} onChange={(e) => setPalavras(e.target.value)} />
          <p className={styles.avisoAssunto}>
            <Info aria-hidden="true" strokeWidth={1.75} />
            {textosNoticias.avisoAcrescentar}
          </p>
          {cheio ? <p className={styles.explica}>{textosNoticias.cheio}</p> : null}
          {erro ? (
            <p role="alert" className={styles.erroAssunto}>
              {erro}
            </p>
          ) : null}
          <div>
            <Botao type="submit" variante="primario" tamanho="md" carregando={ocupado} disabled={ocupado || cheio || somenteLeitura || texto.trim().length < 2}>
              {textosNoticias.acrescentar}
            </Botao>
          </div>
        </form>
      </div>
    </Folha>
  );
}
