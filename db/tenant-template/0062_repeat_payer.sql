-- Tenant migration 0062 (ADR-094): owner decision G of 2026-11-11. Idempotent.
-- When a job card repeats earlier work on the same vehicle, the person who approves it says WHO PAYS (the company, the workshop under its guarantee, or the driver)
-- and WHY, in writing. The reason given on that card is what justifies the answer; there is no fixed rule per cause. The answer is kept on the card, next to the
-- earlier card it repeats, so the quotation and invoice screens can show it. Nothing here changes an amount: the invoice checker still sets what is payable.
alter table job_cards add column if not exists repeat_of uuid references job_cards(id);
alter table job_cards add column if not exists repeat_payer text check (repeat_payer is null or repeat_payer in ('company', 'workshop', 'driver'));
alter table job_cards add column if not exists repeat_payer_reason text check (repeat_payer_reason is null or length(trim(repeat_payer_reason)) >= 5);
do $$ begin
  alter table job_cards drop constraint if exists job_cards_repeat_payer_pair;
  alter table job_cards add constraint job_cards_repeat_payer_pair check ((repeat_payer is null) = (repeat_payer_reason is null) and (repeat_payer is null or repeat_of is not null));
end $$;
create index if not exists job_cards_repeat_of_idx on job_cards(repeat_of) where repeat_of is not null;
