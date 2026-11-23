"use client";

import { Check, CircleAlert, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import type { textosCadastro } from "@/textos/cadastro";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import campo from "@/ui/componentes/Campo.module.css";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { criarContaAction } from "./acoes";
import { CartaoDeConfirmacao } from "./CartaoDeConfirmacao";
import { CabecaDoCartao, CartaoDeConta, CaminhoDoTeste, TelaDeConta } from "./pecas";
import styles from "./pecas.module.css";

export type TextosDoFluxo = {
  tela: typeof textosCadastro.criarConta;
  erros: typeof textosCadastro.erros;
  vazios: typeof textosCadastro.vazios;
  caminho: typeof textosCadastro.caminho;
  confirme: typeof textosCadastro.confirmeSeuEmail;
  trocar: typeof textosCadastro.trocarEmail;
  vencido: typeof textosCadastro.linkVencido;
};

type Campos = "nome" | "negocio" | "email" | "senha" | "aceite";
type Erros = Partial<Record<Campos, string>>;

/**
 * "Crie a sua conta" (E63 PR 2): o formulário, os erros embaixo de cada campo, o "Confira os N pontos" antes do botão, e, depois de criar, o "Confirme o seu e-mail" no mesmo lugar (o
 * caminho do teste avança para o passo 2). A resposta é a mesma para e-mail novo e para e-mail que já tinha conta (`criarContaAction`): a tela nunca conta quem tem conta.
 * Sem `required` do navegador (`noValidate`): quem valida é o servidor, e o texto do erro é o do produto.
 */
export function FluxoCriarConta({ textos }: { textos: TextosDoFluxo }) {
  const t = textos.tela;
  const tratarFalha = useTratarFalha();
  const idSenha = useId();
  const [nome, setNome] = useState("");
  const [negocio, setNegocio] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [aceite, setAceite] = useState(false);
  const [mostrar, setMostrar] = useState(false);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [criada, setCriada] = useState<string | null>(null);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErros({});
    setErroGeral(null);
    setEnviando(true);
    try {
      const r = await criarContaAction({ nome, negocio, email, senha, aceite });
      if (r.ok) {
        setCriada(r.email);
        return;
      }
      if (r.erros) {
        // O servidor só diz "inválido" para o campo vazio; a tela diz a frase de quem esqueceu de escrever.
        const novos: Erros = { ...r.erros };
        if (novos.nome && nome.trim() === "") novos.nome = textos.vazios.nome;
        if (novos.negocio && negocio.trim() === "") novos.negocio = textos.vazios.negocio;
        if (novos.email && email.trim() === "") novos.email = textos.vazios.email;
        if (novos.senha && senha === "") novos.senha = textos.vazios.senha;
        setErros(novos);
      } else {
        setErroGeral(r.erro ?? textos.erros.generico);
      }
    } catch (falha) {
      setErroGeral(tratarFalha(falha, textos.erros.generico, textos.erros.semConexao));
    } finally {
      setEnviando(false);
    }
  }

  if (criada) {
    return (
      <TelaDeConta comCaminho>
        <CartaoDeConfirmacao email={criada} textos={{ confirme: textos.confirme, trocar: textos.trocar, vencido: textos.vencido }} />
        <CaminhoDoTeste passo={2} textos={textos.caminho} />
      </TelaDeConta>
    );
  }

  const quantos = Object.keys(erros).length;
  const idErroSenha = `${idSenha}-erro`;
  return (
    <TelaDeConta comCaminho>
      <CartaoDeConta largo>
        <CabecaDoCartao titulo={t.titulo} subtitulo={t.subtitulo} />
        <form className={styles.formulario} onSubmit={enviar} noValidate aria-label={t.titulo}>
          <div className={styles.campos}>
            <Campo rotulo={t.nome.rotulo} name="nome" autoComplete="name" placeholder={t.nome.marcador} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} />
            <Campo
              rotulo={t.negocio.rotulo}
              ajuda={t.negocio.ajuda}
              name="negocio"
              autoComplete="organization"
              maxLength={80}
              value={negocio}
              onChange={(e) => setNegocio(e.target.value)}
              erro={erros.negocio}
            />
            <Campo
              rotulo={t.email.rotulo}
              ajuda={t.email.ajuda}
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder={t.email.marcador}
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              erro={erros.email}
            />
            <div className={campo.grupo}>
              <label className={campo.rotulo} htmlFor={idSenha}>
                {t.senha.rotulo}
              </label>
              <span className={campo.ajuda}>{t.senha.ajuda}</span>
              <div className={styles.campoSenha}>
                <input
                  id={idSenha}
                  className={[campo.entrada, erros.senha ? campo.comErro : ""].filter(Boolean).join(" ")}
                  type={mostrar ? "text" : "password"}
                  name="senha"
                  autoComplete="new-password"
                  maxLength={128}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  aria-invalid={Boolean(erros.senha)}
                  aria-describedby={erros.senha ? idErroSenha : undefined}
                />
                <button type="button" className={styles.mostrar} aria-label={mostrar ? t.senha.esconder : t.senha.mostrar} aria-pressed={mostrar} onClick={() => setMostrar(!mostrar)}>
                  {mostrar ? <EyeOff aria-hidden="true" strokeWidth={1.5} /> : <Eye aria-hidden="true" strokeWidth={1.5} />}
                </button>
              </div>
              {erros.senha ? (
                <span className={campo.erro} id={idErroSenha} role="alert">
                  <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
                  {erros.senha}
                </span>
              ) : null}
            </div>
          </div>

          <div className={[styles.aceite, erros.aceite ? styles.aceiteComErro : ""].filter(Boolean).join(" ")}>
            <button type="button" role="checkbox" aria-checked={aceite} aria-invalid={Boolean(erros.aceite)} className={styles.marcarAceite} onClick={() => setAceite(!aceite)}>
              <span className={styles.caixa}>{aceite ? <Check aria-hidden="true" strokeWidth={2.5} /> : null}</span>
              <span>{t.aceite}</span>
            </button>
            {erros.aceite ? (
              <span className={styles.erroCampo} role="alert">
                <CircleAlert aria-hidden="true" strokeWidth={1.5} />
                {erros.aceite}
              </span>
            ) : null}
            <div className={styles.linksAceite}>
              <Link href="/termos" className={styles.linkTexto} target="_blank">
                {t.lerTermos}
              </Link>
              <Link href="/privacidade" className={styles.linkTexto} target="_blank">
                {t.lerPrivacidade}
              </Link>
            </div>
          </div>

          {quantos > 0 ? (
            <p className={styles.erroGeral} role="alert">
              <CircleAlert aria-hidden="true" strokeWidth={1.5} />
              {quantos === 1 ? t.confiraUm : t.confiraVarios.replace("{n}", String(quantos))}
            </p>
          ) : null}
          {erroGeral ? (
            <p className={styles.erroGeral} role="alert">
              <CircleAlert aria-hidden="true" strokeWidth={1.5} />
              {erroGeral}
            </p>
          ) : null}

          <div className={styles.botaoELinha}>
            <Botao type="submit" tamanho="lg" carregando={enviando} precisaDeRede>
              {enviando ? t.enviando : t.botao}
            </Botao>
            <p className={styles.linhaTeste}>
              <strong>{t.linhaTeste.destaque}</strong> {t.linhaTeste.limites} {t.linhaTeste.preco}
            </p>
          </div>
        </form>
      </CartaoDeConta>
      <p className={styles.rodape}>
        {t.jaTemConta}{" "}
        <Link href="/entrar" className={styles.linkTexto}>
          {t.entrar}
        </Link>
      </p>
      <CaminhoDoTeste passo={1} textos={textos.caminho} />
    </TelaDeConta>
  );
}
