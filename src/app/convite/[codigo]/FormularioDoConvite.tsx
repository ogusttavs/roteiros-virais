"use client";

import { Check, CircleAlert, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { CabecaDoCartao, CartaoDeConta, TelaDeConta } from "@/app/cadastro/pecas";
import styles from "@/app/cadastro/pecas.module.css";
import type { textosConviteDeGrupo } from "@/textos/convite-de-grupo";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import campo from "@/ui/componentes/Campo.module.css";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { aceitarConviteAction } from "./acoes";

type Textos = { pagina: typeof textosConviteDeGrupo.pagina; erros: typeof textosConviteDeGrupo.erros };
type Campos = "nome" | "negocio" | "email" | "senha" | "aceite";
type Erros = Partial<Record<Campos, string>>;

/** O formulário do convite de grupo: seu nome, nome da empresa, e-mail, senha e o aceite dos termos. Sem `required` do navegador: quem valida é o servidor. */
export function FormularioDoConvite({ codigo, textos }: { codigo: string; textos: Textos }) {
  const t = textos.pagina;
  const router = useRouter();
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

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setErros({});
    setErroGeral(null);
    setEnviando(true);
    try {
      const r = await aceitarConviteAction(codigo, { nome, negocio, email, senha, aceite });
      if (r.ok) {
        router.replace("/comecar");
        return;
      }
      if (r.invalido) {
        router.refresh();
        return;
      }
      if (r.erros) setErros(r.erros);
      else setErroGeral(r.erro ?? textos.erros.generico);
    } catch (falha) {
      setErroGeral(tratarFalha(falha, textos.erros.generico, textos.erros.semConexao));
    } finally {
      setEnviando(false);
    }
  }

  const quantos = Object.keys(erros).length;
  return (
    <TelaDeConta>
      <CartaoDeConta largo>
        <CabecaDoCartao titulo={t.titulo} subtitulo={t.subtitulo} />
        <form className={styles.formulario} onSubmit={enviar} noValidate aria-label={t.titulo}>
          <div className={styles.campos}>
            <Campo rotulo={t.nome.rotulo} name="nome" autoComplete="name" placeholder={t.nome.marcador} maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} erro={erros.nome} />
            <Campo rotulo={t.empresa.rotulo} ajuda={t.empresa.ajuda} name="negocio" autoComplete="organization" maxLength={80} value={negocio} onChange={(e) => setNegocio(e.target.value)} erro={erros.negocio} />
            <Campo
              rotulo={t.email.rotulo}
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
                />
                <button type="button" className={styles.mostrar} aria-label={mostrar ? t.senha.esconder : t.senha.mostrar} aria-pressed={mostrar} onClick={() => setMostrar(!mostrar)}>
                  {mostrar ? <EyeOff aria-hidden="true" strokeWidth={1.5} /> : <Eye aria-hidden="true" strokeWidth={1.5} />}
                </button>
              </div>
              {erros.senha ? (
                <span className={campo.erro} role="alert">
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
          </div>
        </form>
      </CartaoDeConta>
      <p className={styles.rodape}>
        {t.jaTemConta}{" "}
        <Link href="/entrar" className={styles.linkTexto}>
          {t.entrar}
        </Link>
      </p>
    </TelaDeConta>
  );
}
