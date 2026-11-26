import { getOrders } from "@/services/orders";
import OperatorDashboard from "@/components/OperatorDashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const orders = await getOrders();
  return <OperatorDashboard initialOrders={orders} />;
}
