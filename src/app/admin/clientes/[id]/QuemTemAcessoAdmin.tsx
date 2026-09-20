"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PapelMarca } from "@/db/schema";
import { iniciaisDe } from "@/lib/iniciais";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { FolhaSenhaGerada } from "../FolhaSenhaGerada";
import { darAcessoAction, gerarSenhaNovaAction, tirarAcessoAction } from "./acoes";
import styles from "./QuemTemAcessoAdmin.module.css";

const t = textosAdmin.acessos;

/**
 * `semNome` vem pronto do servidor (`page.tsx`), nao e recalculado aqui:
 * este e um client component, e `NOME_SEM_NOME_AINDA` mora em
 * `@/servicos/clientes`, que importa `next/headers` (so funciona no
 * servidor). Importar dali travaria o build ("You're importing a component
 * that needs next/headers").
 */
export type Membro = { usuarioId: string; nome: string; email: string; papel: PapelMarca; semNome: boolean };

type Props = {
  clienteId: number;
  nomeMarca: string;
  membros: Membro[];
};

/**
 * "Quem tem acesso" (V3, item 5, AdminCliente.dc.html): cartão com a lista
 * por pessoa, a folha "Dar acesso" (email, os dois caminhos) e a folha de
 * senha gerada (compartilhada com "Convidar cliente"); "Tirar o acesso"
 * confirma na própria linha; o dono nunca mostra esse botão.
 */
export function QuemTemAcessoAdmin({ clienteId, nomeMarca, membros }: Props) {
  const router = useRouter();
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDarAcesso, setErroDarAcesso] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null);
  const [avisoJaTinhaLogin, setAvisoJaTinhaLogin] = useState<string | null>(null);
  const [confirmandoTirar, setConfirmandoTirar] = useState<string | null>(null);
  const [processando, setProcessando] = useState<string | null>(null);
  const [senhaPorUsuario, setSenhaPorUsuario] = useState<Record<string, string>>({});
  const [erroLinha, setErroLinha] = useState<{ usuarioId: string; texto: string } | null>(null);

  async function darAcesso(evento: FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErroDarAcesso(null);
    const resultado = await darAcessoAction(clienteId, email);
    setEnviando(false);
    if (!resultado.ok) {
      setErroDarAcesso(resultado.erro);
      return;
    }
    setFolhaAberta(false);
    if (resultado.dado.tipo === "convite") {
      setSenhaGerada({ email, senha: resultado.dado.senha });
    } else {
      setAvisoJaTinhaLogin(t.jaTinhaLoginAviso(resultado.dado.nome));
    }
    setEmail("");
    router.refresh();
  }

  async function gerarSenha(usuarioId: string) {
    setProcessando(usuarioId);
    try {
      const senha = await gerarSenhaNovaAction(usuarioId);
      setSenhaPorUsuario((atual) => ({ ...atual, [usuarioId]: senha }));
    } catch {
      setErroLinha({ usuarioId, texto: t.erroGerarSenha });
    } finally {
      setProcessando(null);
    }
  }

  async function tirarAcesso(usuarioId: string) {
    setProcessando(usuarioId);
    const resultado = await tirarAcessoAction(clienteId, usuarioId);
    setProcessando(null);
    if (!resultado.ok) {
      setErroLinha({ usuarioId, texto: resultado.erro });
      return;
    }
    setConfirmandoTirar(null);
    router.refresh();
  }

  return (
    <section className={styles.acessos} aria-label={t.titulo}>
      <div className={styles.cabecalho}>
        <h2>{t.titulo}</h2>
        <span className={styles.quantos}>{t.quantos(membros.length)}</span>
        <Botao type="button" variante="ghost" onClick={() => setFolhaAberta(true)} className={styles.botaoDarAcesso}>
          {t.darAcesso}
        </Botao>
      </div>

      {avisoJaTinhaLogin ? (
        <p className={styles.avisoCurto} role="status">
          {avisoJaTinhaLogin}
        </p>
      ) : null}

      <ul className={styles.pessoas}>
        {membros.map((membro) => {
          const senhaDaLinha = senhaPorUsuario[membro.usuarioId];
          return (
            <li key={membro.usuarioId} className={confirmandoTirar === membro.usuarioId ? styles.pedindo : styles.pessoa}>
              <span className={styles.avatar} aria-hidden="true">
                {membro.semNome ? "?" : iniciaisDe(membro.nome)}
              </span>
              <div className={styles.quem}>
                <div className={styles.linhaNome}>
                  <span className={membro.semNome ? `${styles.nome} ${styles.semNome}` : styles.nome}>
                    {membro.semNome ? t.semNomeAinda : membro.nome}
                  </span>
                  <span className={styles.etiqueta}>{membro.papel === "dono" ? t.dono : t.membro}</span>
                </div>
                <span className={styles.email}>{membro.email}</span>
                {senhaDaLinha ? (
                  <p className={styles.senhaLinha}>
                    {t.senhaInicial}: <strong>{senhaDaLinha}</strong>
                  </p>
                ) : null}
                {erroLinha?.usuarioId === membro.usuarioId ? (
                  <p className={styles.erroLinha} role="alert">
                    {erroLinha.texto}
                  </p>
                ) : null}
              </div>

              {confirmandoTirar === membro.usuarioId ? (
                <div className={styles.confirmacao}>
                  <p>{t.confirmarTirarOAcesso(membro.nome, nomeMarca)}</p>
                  <div className={styles.confirmacaoAcoes}>
                    <Botao
                      type="button"
                      carregando={processando === membro.usuarioId}
                      onClick={() => tirarAcesso(membro.usuarioId)}
                    >
                      {t.tirarOAcesso}
                    </Botao>
                    <Botao type="button" variante="ghost" onClick={() => setConfirmandoTirar(null)}>
                      {t.cancelar}
                    </Botao>
                  </div>
                </div>
              ) : (
                <div className={styles.acoesPessoa}>
                  <Botao
                    type="button"
                    variante="ghost"
                    carregando={processando === membro.usuarioId && !senhaDaLinha}
                    onClick={() => gerarSenha(membro.usuarioId)}
                  >
                    {t.gerarSenhaNova}
                  </Botao>
                  {membro.papel !== "dono" ? (
                    <Botao type="button" variante="ghost" onClick={() => setConfirmandoTirar(membro.usuarioId)}>
                      {t.tirarOAcesso}
                    </Botao>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className={styles.rodape}>{t.rodape}</p>

      {folhaAberta ? (
        <div className={styles.backdrop} onClick={() => setFolhaAberta(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.aoDarAcessoTitulo(nomeMarca)}
            className={styles.folha}
            onClick={(evento) => evento.stopPropagation()}
          >
            <h3 className={styles.folhaTitulo}>{t.aoDarAcessoTitulo(nomeMarca)}</h3>
            <form onSubmit={darAcesso} className={styles.forma}>
              <Campo
                rotulo={t.campoEmail}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <ul className={styles.caminhos}>
                <li>{t.ajudaEmailJaTemLogin}</li>
                <li>{t.ajudaEmailNovo}</li>
              </ul>
              {erroDarAcesso ? (
                <p className={styles.erro} role="alert">
                  {erroDarAcesso}
                </p>
              ) : null}
              <div className={styles.folhaAcoes}>
                <Botao type="button" variante="ghost" onClick={() => setFolhaAberta(false)}>
                  {t.cancelar}
                </Botao>
                <Botao type="submit" carregando={enviando}>
                  {t.darAcesso}
                </Botao>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {senhaGerada ? (
        <FolhaSenhaGerada
          email={senhaGerada.email}
          senha={senhaGerada.senha}
          onFechar={() => setSenhaGerada(null)}
        />
      ) : null}
    </section>
  );
}
