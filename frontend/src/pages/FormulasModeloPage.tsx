import { useParams } from 'react-router-dom';
import FormulasModeloEditor from '../components/FormulasModeloEditor';

// Rota /modelos/:driverId/formulas — visão em tela cheia do editor de fórmulas.
// Toda a lógica vive em FormulasModeloEditor (reutilizado inline na tela de Modelagem).
export default function FormulasModeloPage() {
  const { driverId: driverIdParam } = useParams();
  const driverId = Number(driverIdParam);
  return <FormulasModeloEditor driverId={driverId} standalone />;
}
