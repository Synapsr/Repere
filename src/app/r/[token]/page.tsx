import { Review } from "@/components/review";
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Review key={token} token={token} />;
}
