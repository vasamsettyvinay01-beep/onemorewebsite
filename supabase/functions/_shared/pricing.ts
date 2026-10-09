/** Venue used for Houston ticket tax. The browser never supplies this. */
export const VENUE_ADDRESS = {
  line1: "2515 Morse St",
  city: "Houston",
  state: "TX",
  postal_code: "77019",
  country: "US",
} as const;

export const TICKET_TAX_CODE = "txcd_50010001";
export const PERFORMANCE_LOCATION = "taxloc_1UOYi1FhhmOQLzPEyZNgpBcS";

type TaxClient = {
  tax: {
    calculations: {
      create: (params: Record<string, unknown>) => Promise<{
        id: string;
        tax_amount_exclusive: number;
        amount_total: number;
      }>;
    };
  };
};

/** Exclusive ticket tax for a server-priced line. Amounts are integer cents. */
export async function quoteTicketTotal(
  stripe: TaxClient,
  currency: string,
  unitCents: number,
  quantity: number,
  reference: string,
): Promise<{ tax: number; total: number; calculationId: string }> {
  const calculation = await stripe.tax.calculations.create({
    currency,
    customer_details: { address: VENUE_ADDRESS, address_source: "billing" },
    line_items: [
      {
        amount: unitCents * quantity,
        reference,
        tax_behavior: "exclusive",
        tax_code: TICKET_TAX_CODE,
        performance_location: PERFORMANCE_LOCATION,
      },
    ],
  });
  return {
    tax: calculation.tax_amount_exclusive,
    total: calculation.amount_total,
    calculationId: calculation.id,
  };
}
