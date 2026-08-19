# Xiaomi MiMo × ModelHub: candidate case study

ModelHub is submitting this practical demonstration for evaluation in the MiMo
Spark Program. It does not claim that ModelHub has already been accepted as an
official core user. Any early access to future models is an opportunity offered
by the program, not a guarantee.

## The real task

We asked MiMo V2.5 Pro, through Xiaomi's interactive MiMo Studio, to review the
existing TypeScript provider integration in ModelHub against the current MiMo
API documentation. The prompt included the real URL-building logic and model
catalog, plus the documented distinction between pay-as-you-go and Token Plan
access.

## What MiMo caught

MiMo highlighted three concrete migration risks:

1. Treating a dedicated Token Plan endpoint as if it were the generic
   pay-as-you-go endpoint.
2. Appending `/v1` to a base URL that may already include `/v1`, producing a
   duplicated path.
3. Keeping retired V2 model IDs instead of the current MiMo V2.5 family.

The review also produced a focused test plan for endpoint construction and a
migration note for existing deployments.

## Human verification changed the implementation decision

The dedicated plan explicitly allows interactive use with compatible coding
and agent tools, but not automated scripts or application backends. We therefore
did **not** place the credential in ModelHub, did **not** commit it, and did
**not** ship the proposed backend patch. Instead, the verified outcome was:

- keep the credential outside the repository and browser/client code;
- document the current API and model migration risks;
- correct public wording so candidate status and early-access expectations are
  unambiguous;
- preserve the provider code until a backend-authorized credential is available.

This is the practical value of the case: MiMo accelerated a real code review,
while human validation enforced the product and credential boundaries.

## Demo artifact

The accompanying eight-second square video was created locally with
[HyperFrames](https://github.com/heygen-com/hyperframes). It contains no API
keys, account identifiers, balances, or private endpoint values.

- [Published demo on X](https://x.com/AlexRobertoSch1/status/2087893882692391275)
- [Rendered MP4](../../videos/xiaomi-mimo-case-study/renders/modelhub-xiaomi-mimo-spark.mp4)

## References

- [MiMo API first call](https://mimo.mi.com/docs/en-US/quick-start/summary/first-api-call)
- [MiMo model deprecation notice](https://mimo.mi.com/docs/en-US/notice/2026-06-30)
- [HyperFrames source](https://github.com/heygen-com/hyperframes)
