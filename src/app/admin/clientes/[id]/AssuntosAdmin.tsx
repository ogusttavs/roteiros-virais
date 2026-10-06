"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { adicionarAssuntoAction, fixarAssuntoAction, removerAssuntoAction } from "./acoes";
import styles from "./RamosAlternativosAdmin.module.css";

const t = textosAdmin.assuntos;

export type AssuntoNaTela = { id: number; texto: string; termos: string[]; fixado: boolean; criadoEm: string; ultimoAbertoEm: string | null; noticias: number };

function formatarData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(new Date(iso));
}

/**
 * E53: "Assuntos que a marca acompanha" na página da conta (o admin por ela; a tela da pessoa vem com o desenho do Opus). Até cinco: o texto do assunto e, se quiser, os termos que
 * casam com uma notícia. Sai sozinho depois de 30 dias sem a pessoa abrir uma notícia dele, a não ser que esteja fixado.
 */
export function AssuntosAdmin({ clienteId, assuntos }: { clienteId: number; assuntos: AssuntoNaTela[] }) {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [termos, setTermos] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function executar(tarefa: () => Promise<{ ok: boolean; erro?: string }>) {
    setOcupado(true);
    setErro(null);
    const resultado = await tarefa();
    setOcupado(false);
    if (!resultado.ok) {
      setErro(resultado.erro ?? "");
      return false;
    }
    router.refresh();
    return true;
  }

  async function adicionar(evento: FormEvent) {
    evento.preventDefault();
    if (await executar(() => adicionarAssuntoAction(clienteId, texto, termos))) {
      setTexto("");
      setTermos("");
    }
  }

  return (
    <section className={styles.secao} aria-labelledby="assuntos-titulo" data-assuntos-da-marca>
      <h2 id="assuntos-titulo" className={styles.titulo}>
        {t.titulo}
      </h2>
      <p className={styles.ajuda}>{t.ajuda}</p>

      {assuntos.length === 0 ? (
        <p className={styles.vazio}>{t.vazio}</p>
      ) : (
        <ul className={styles.lista}>
          {assuntos.map((a) => (
            <li key={a.id} className={styles.item} data-assunto={a.id}>
              <div className={styles.texto}>
                <strong>
                  {a.texto}
                  {a.fixado ? ` (${t.fixado})` : ""}
                </strong>
                <span className={styles.detalhe}>
                  {t.desde(formatarData(a.criadoEm))}, {t.noticias(a.noticias)}, {a.ultimoAbertoEm ? t.ultimaAbertura(formatarData(a.ultimoAbertoEm)) : t.semAberturas}
                </span>
                {a.termos.length > 0 ? <span className={styles.detalhe}>{t.termos(a.termos.join(", "))}</span> : null}
              </div>
              <Botao variante="secundario" disabled={ocupado} onClick={() => executar(() => fixarAssuntoAction(clienteId, a.id, !a.fixado))}>
                {a.fixado ? t.desafixar : t.fixar}
              </Botao>
              <Botao variante="secundario" disabled={ocupado} aria-label={t.tirarAssunto(a.texto)} onClick={() => executar(() => removerAssuntoAction(clienteId, a.id))}>
                {t.tirar}
              </Botao>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.encaixe} onSubmit={adicionar}>
        <Campo rotulo={t.campoAssunto} value={texto} maxLength={60} onChange={(e) => setTexto(e.target.value)} />
        <Campo rotulo={t.campoTermos} value={termos} onChange={(e) => setTermos(e.target.value)} />
        <p className={styles.detalhe}>{t.aviso}</p>
        {erro ? (
          <p role="alert" className={styles.vazio}>
            {erro}
          </p>
        ) : null}
        <div className={styles.acoes}>
          <Botao type="submit" disabled={ocupado || texto.trim().length < 2}>
            {t.adicionar}
          </Botao>
        </div>
      </form>
    </section>
  );
}
