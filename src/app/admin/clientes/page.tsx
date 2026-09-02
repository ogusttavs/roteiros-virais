import { db } from "@/db";
import { nichos } from "@/db/schema";
import { listarClientes } from "@/servicos/clientes";
import { textosAdmin } from "@/textos/admin";

import { FormularioNovoCliente } from "./FormularioNovoCliente";
import styles from "./page.module.css";

const t = textosAdmin.clientes;

export default async function AdminClientes() {
  const [clientesListados, nichosListados] = await Promise.all([
    listarClientes(),
    db().select({ id: nichos.id, nome: nichos.nome }).from(nichos),
  ]);

  return (
    <div className={styles.pagina}>
      <h1>{t.titulo}</h1>

      {clientesListados.length === 0 ? (
        <p>{t.vazio}</p>
      ) : (
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>{t.colunaNome}</th>
              <th>{t.colunaEmail}</th>
              <th>{t.colunaNicho}</th>
              <th>{t.colunaStatus}</th>
            </tr>
          </thead>
          <tbody>
            {clientesListados.map((cliente) => (
              <tr key={cliente.id}>
                <td>{cliente.nome}</td>
                <td>{cliente.email}</td>
                <td>{cliente.nichoNome ?? t.semNicho}</td>
                <td>{cliente.ativo ? t.ativo : t.inativo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <h2>{t.novoTitulo}</h2>
        <FormularioNovoCliente nichos={nichosListados} />
      </div>
    </div>
  );
}
