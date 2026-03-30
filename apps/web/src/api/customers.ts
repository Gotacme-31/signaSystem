import { apiFetch } from "./http";

export async function registerCustomer(input: { name: string; phone: string }) {
  return apiFetch<{ customerId: number; isNew: boolean }>("/customers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getCustomerById(id: number) {
  return apiFetch<{ id: number; name: string; phone: string }>(`/customers/${id}`);
}

export async function searchCustomers(query: string): Promise<Array<{ id: number; name: string; phone: string }>> {
  const searchQuery = query.trim();
  if (!searchQuery) return [];
  
  return apiFetch<Array<{ id: number; name: string; phone: string }>>(
    `/customers/search?q=${encodeURIComponent(searchQuery)}`
  );
}