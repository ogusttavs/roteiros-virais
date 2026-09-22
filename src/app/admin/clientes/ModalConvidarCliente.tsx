"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { textosAdmin } from "@/textos/admin";
import { Botao } from "@/ui/componentes/Botao";
import { Campo } from "@/ui/componentes/Campo";
import { Toast } from "@/ui/componentes/Toast";

import { criarClienteAction } from "./acoes";
import { FolhaSenhaGerada } from "./FolhaSenhaGerada";
import styles from "./ModalConvidarCliente.module.css";

const t = textosAdmin.clientes;

type Props = {
  nichos: { id: number; nome: string }[];
  aberto: boolean;
  onFechar: () => void;
};

export function ModalConvidarCliente({ nichos, aberto, onFechar }: Props) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [nichoId, setNichoId] = useState(nichos[0]?.id ?? 0);
  const [tipo, setTipo] = useState<"negocio" | "pessoa">("negocio");
  const [convidando, setConvidando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [toastTexto, setToastTexto] = useState<string | null>(null);
  /** V3, item 5: e-mail novo mostra a senha gerada antes de fechar de vez. */
  const [senhaGerada, setSenhaGerada] = useState<{ email: string; senha: string } | null>(null);

  async function convidar(evento: FormEvent) {
    evento.preventDefault();
    setConvidando(true);
    setErro(null);
    try {
      const resultado = await criarClienteAction({ nome, email, nichoId, tipo });
      setNome("");
      onFechar();
      if (resultado.tipo === "convite") {
        setSenhaGerada({ email, senha: resultado.senha });
      } else {
        setToastTexto(t.sucessoJaTinhaLogin(email));
      }
      setEmail("");
      router.refresh();
    } catch {
      setErro(t.erroConvite);
    } finally {
      setConvidando(false);
    }
  }

  return (
    <>
      {aberto ? (
        <div className={styles.backdrop} onClick={onFechar}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t.modalTitulo}
            className={styles.painel}
            onClick={(evento) => evento.stopPropagation()}
          >
            <h2 className={styles.titulo}>{t.modalTitulo}</h2>
            <form className={styles.forma} onSubmit={convidar}>
              <Campo rotulo={t.campoNome} required value={nome} onChange={(e) => setNome(e.target.value)} />
              <Campo
                rotulo={t.campoEmail}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                ajuda={t.ajudaEmailJaExiste}
              />
              <label className={styles.rotuloSelect}>
                {t.campoNicho}
                <select
                  className={styles.select}
                  aria-label={t.campoNicho}
                  value={nichoId}
                  onChange={(e) => setNichoId(Number(e.target.value))}
                >
                  {nichos.map((nicho) => (
                    <option key={nicho.id} value={nicho.id}>
                      {nicho.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.rotuloSelect}>
                {t.campoTipo}
                <select
                  className={styles.select}
                  aria-label={t.campoTipo}
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as "negocio" | "pessoa")}
                >
                  <option value="negocio">{t.tipoNegocio}</option>
                  <option value="pessoa">{t.tipoPessoa}</option>
                </select>
              </label>
              {erro ? (
                <p className={styles.erro} role="alert">
                  {erro}
                </p>
              ) : null}
              <Botao type="submit" tamanho="lg" carregando={convidando}>
                {convidando ? t.convidando : t.botaoConvidar}
              </Botao>
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
      <Toast texto={toastTexto ?? ""} aberto={Boolean(toastTexto)} onFechar={() => setToastTexto(null)} />
    </>
  );
}
