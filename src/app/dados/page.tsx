import { textosTermos } from "@/textos/termos";
import { PaginaLegal } from "@/ui/componentes/PaginaLegal";

export default function Dados() {
  return <PaginaLegal titulo={textosTermos.dados.titulo} secoes={textosTermos.dados.secoes} />;
}
