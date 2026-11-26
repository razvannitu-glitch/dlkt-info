# Local source photos — verification observations

Contract: docs/local-source-photos-20261126-contract.md. Base: 04c19db4b1ff1151ab0590ab50b4a3692e666708. Implementation candidate: d009639869175d94bc2a28c111b7feea088f6f9f.

The first bounded source observation (workflow45726653109, commit8788390f52f85f1d102c6ed6453384b40ed37a4d) established that ARCUB repeats a generic OG image while its header contains a distinct original image. This observation did not establish an event-specific image download: the initial probe downloaded that repeated social tile. The second bounded probe (workflow45727509278, implementation candidate above) used the new source-specific parser and verified two actual original event heroes, successful WebP responses, dimensions, byte sizes and hashes. Exact evidence is retained in local-source-photos-20261126-primary-evidence.json. No publisher licence was inferred.

The first generation attempt45727511150 compiled strict TypeScript and passed52packaging checks. Release verification failed with7application tests:4new official fixtures used abbreviated months incompatible with the real agenda parser;2exact-compiled-module assertions lacked the new import mapping;1public curation test exposed the missing module in the explicit release allowlist. The correction uses full Romanian month names in the fixture and includes the module in the production allowlist and unchanged equality/import-resolution gates. No parser or gate is relaxed.

Independent read-only review identified two further concrete improvements: the new official path needs a real HTTP-handler test to substantiate no image acquisition on rejected identities, and image-path robots policy must be checked before source-image/redirect requests. Both are included in the corrected candidate. Existing global/local-news rules remain intact. The observed live source parser path is unchanged by these corrections.

No production change has occurred at this checkpoint. Browser geometry, exact final release generation, final independent review, promotion and production image readback remain required. Pending Supabase authentication has not been used or changed.
