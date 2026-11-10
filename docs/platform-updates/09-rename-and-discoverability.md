# 9. The rename to Amazon Connect Customer

Status: decided, not implemented. Very low priority.

## Platform change

Since April 2026, "Amazon Connect" is the name of a product family, and the contact centre product is "Amazon Connect Customer". AWS documentation now uses "Connect Customer" throughout.

The API reference states that the old and new names are used interchangeably. The `connect:` IAM prefix, the ARN format (`arn:aws:connect:...`) and the SDK package (`@aws-sdk/client-connect`) are unchanged.

References: [API reference: Welcome](https://docs.aws.amazon.com/connect/latest/APIReference/Welcome.html).

## Effect on this package

None on behaviour. The only effect is on how people find the tool. The old name appears in:

- the npm description and keywords (`aws`, `amazon-connect`, `contact-flow`, `cli`),
- the README title and opening line,
- the GitHub repository description and topics.

A search for "Amazon Connect Customer" still matches "Amazon Connect". Over time, people newer to the product may search for "Connect Customer" alone.

## Decisions

1. **Keep "Amazon Connect" as the primary name.**
2. **Mention "Amazon Connect Customer" once** in the README's opening line and in the npm description.
3. **Extend the npm keywords:** `amazon-connect-customer`, `connect-customer`, `contact-center`, `flow-module`, `migration`, `deployment`.
4. **Leave the package name as it is.**
5. **Update the GitHub repository description and topics** to match.
6. **Ship with the next release.** The npm description and keywords only change on publish.
