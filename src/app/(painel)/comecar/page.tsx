import { textosVazio } from "@/textos/vazio";
import { EstadoVazio } from "@/ui/componentes/EstadoVazio";

export default function Comecar() {
  return (
    <EstadoVazio titulo={textosVazio.comecar.titulo} descricao={textosVazio.comecar.descricao} />
  );
}
