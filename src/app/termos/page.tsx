import { textosTermos } from "@/textos/termos";
import { PaginaLegal } from "@/ui/componentes/PaginaLegal";

export default function Termos() {
  return <PaginaLegal titulo={textosTermos.termos.titulo} secoes={textosTermos.termos.secoes} />;
}
