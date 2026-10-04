"use client";

import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import type { PapelMarca } from "@/db/schema";
import { iniciaisDe } from "@/lib/iniciais";
import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";

import { FolhaSenhaGerada } from "../FolhaSenhaGerada";

import { darAcessoAction, entrarVerComoAction, gerarSenhaNovaAction, renomearPessoaAction, tirarAcessoAction } from "./acoes";
import styles from "./QuemTemAcessoAdmin.module.css";

const t = textosAdmin.acessos;

/**
 * `semNome` vem pronto do servidor (`page.tsx`), nao e recalculado aqui:
 * este e um client component, e `NOME_SEM_NOME_AINDA` mora em
 * `@/servicos/clientes`, que importa `next/headers` (so funciona no
 * servidor). Importar dali travaria o build ("You're importing a component
 * that needs next/headers").
 */
/** `podeVerComo` (E46 PR 2): a pessoa não é administradora; o servidor confere de novo. */
export type Membro = { usuarioId: string; nome: string; email: string; papel: PapelMarca; semNome: boolean; podeVerComo: boolean };

type Props = {
  clienteId: number;
  nomeMarca: string;
  membros: Membro[];
};

/**
 * "Quem tem acesso" (V3, item 5, AdminCliente.dc.html): cartão com a lista
 * por pessoa, a folha "Dar acesso" (nome e email, os dois caminhos, V12b
 * item 4) e a folha de senha gerada (compartilhada com "Nova marca"); "Tirar
 * o acesso" confirma na própria linha, "editar" o nome também (V12b, item
 * 4); o dono nunca mostra o botão de tirar.
 */
export function QuemTemAcessoAdmin({ clienteId, nomeMarca, membros }: Props) {
  const router = useRouter();
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroDarAcesso, setErroDarAcesso] = useState<string | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null);
  const [avisoJaTinhaLogin, setAvisoJaTinhaLogin] = useState<string | null>(null);
  const [confirmandoTirar, setConfirmandoTirar] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");
  const [processando, setProcessando] = useState<string | null>(null);
  const [senhaPorUsuario, setSenhaPorUsuario] = useState<Record<string, string>>({});
  const [erroLinha, setErroLinha] = useState<{ usuarioId: string; texto: string } | null>(null);
  // E46 PR 2: a folha "Ver o painel como" (a pessoa escolhida; `null` é fechada).
  const [verComoDe, setVerComoDe] = useState<string | null>(null);
  const [entrandoVerComo, setEntrandoVerComo] = useState(false);
  const [erroVerComo, setErroVerComo] = useState<string | null>(null);
  const pessoasVisiveis = membros.filter((m) => m.podeVerComo);
  const pessoaVerComo = pessoasVisiveis.find((m) => m.usuarioId === verComoDe) ?? null;

  async function entrarVerComo() {
    if (!pessoaVerComo) return;
    setEntrandoVerComo(true);
    setErroVerComo(null);
    try {
      // Sucesso redireciona para o painel (a Server Action chama `redirect`); só volta aqui quando recusa.
      const resultado = await entrarVerComoAction(clienteId, pessoaVerComo.usuarioId);
      if (resultado && !resultado.ok) setErroVerComo(resultado.erro);
    } catch (erro) {
      // `redirect` lança um erro especial que o Next trata; qualquer outro erro vira a frase de sempre.
      if (erro && typeof erro === "object" && "digest" in erro && String((erro as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw erro;
      setErroVerComo(t.verComoErro);
    } finally {
      setEntrandoVerComo(false);
    }
  }

  async function darAcesso(evento: FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErroDarAcesso(null);
    const resultado = await darAcessoAction(clienteId, nomeNovo, email);
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
    setNomeNovo("");
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

  function iniciarEdicaoNome(membro: Membro) {
    setConfirmandoTirar(null);
    setErroLinha(null);
    setEditandoNome(membro.usuarioId);
    setNomeEditado(membro.semNome ? "" : membro.nome);
  }

  async function salvarNome(usuarioId: string) {
    setProcessando(usuarioId);
    const resultado = await renomearPessoaAction(clienteId, usuarioId, nomeEditado);
    setProcessando(null);
    if (!resultado.ok) {
      setErroLinha({ usuarioId, texto: resultado.erro });
      return;
    }
    setEditandoNome(null);
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

              {editandoNome === membro.usuarioId ? (
                <div className={styles.confirmacao}>
                  <Campo
                    rotulo={t.campoNome}
                    rotuloOculto
                    value={nomeEditado}
                    onChange={(e) => setNomeEditado(e.target.value)}
                  />
                  <div className={styles.confirmacaoAcoes}>
                    <Botao
                      type="button"
                      carregando={processando === membro.usuarioId}
                      onClick={() => salvarNome(membro.usuarioId)}
                    >
                      {processando === membro.usuarioId ? t.salvandoNome : t.salvarNome}
                    </Botao>
                    <Botao type="button" variante="ghost" onClick={() => setEditandoNome(null)}>
                      {t.cancelar}
                    </Botao>
                  </div>
                </div>
              ) : confirmandoTirar === membro.usuarioId ? (
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
                  {membro.podeVerComo ? (
                    <Botao type="button" variante="ghost" aria-label={t.verComoDe(membro.nome)} onClick={() => { setErroVerComo(null); setVerComoDe(membro.usuarioId); }}>
                      <Eye size={14} strokeWidth={1.5} aria-hidden="true" /> {t.verComo}
                    </Botao>
                  ) : null}
                  <Botao type="button" variante="ghost" onClick={() => iniciarEdicaoNome(membro)}>
                    {t.editarNome}
                  </Botao>
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
              <Campo rotulo={t.campoNome} required value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
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

      {pessoaVerComo ? (
        <div className={styles.backdrop} onClick={() => setVerComoDe(null)}>
          <div role="dialog" aria-modal="true" aria-label={t.verComoTitulo} className={styles.folha} onClick={(evento) => evento.stopPropagation()}>
            <h3 className={styles.folhaTitulo}>{t.verComoTitulo}</h3>
            <div className={styles.escolhaPessoa} role="radiogroup" aria-label={t.verComoTitulo}>
              {pessoasVisiveis.map((m) => (
                <button
                  key={m.usuarioId}
                  type="button"
                  role="radio"
                  aria-checked={m.usuarioId === pessoaVerComo.usuarioId}
                  className={styles.opcaoPessoa}
                  onClick={() => setVerComoDe(m.usuarioId)}
                >
                  <span className={styles.quem}>
                    <span className={styles.nome}>{m.semNome ? t.semNomeAinda : m.nome}</span>
                    <span className={styles.email}>{m.email}</span>
                  </span>
                  <span className={styles.etiqueta}>{m.papel === "dono" ? t.dono : t.membro}</span>
                </button>
              ))}
            </div>
            <p className={styles.avisoVerComo}>{t.verComoAviso(pessoaVerComo.semNome ? pessoaVerComo.email : pessoaVerComo.nome, nomeMarca)}</p>
            <ul className={styles.caminhos}>
              {t.verComoCaminhos.map((texto) => (
                <li key={texto}>{texto}</li>
              ))}
            </ul>
            {erroVerComo ? (
              <p className={styles.erro} role="alert">
                {erroVerComo}
              </p>
            ) : null}
            <div className={styles.folhaAcoes}>
              <Botao type="button" variante="ghost" onClick={() => setVerComoDe(null)}>
                {t.cancelar}
              </Botao>
              <Botao type="button" carregando={entrandoVerComo} onClick={entrarVerComo}>
                {entrandoVerComo ? t.verComoEntrando : t.verComoEntrar(pessoaVerComo.semNome ? pessoaVerComo.email : pessoaVerComo.nome)}
              </Botao>
            </div>
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
