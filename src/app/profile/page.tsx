import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

async function saveProfile(formData: FormData) {
  "use server";

  const data = {
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    addressLine1: String(formData.get("addressLine1") ?? "") || null,
    city: String(formData.get("city") ?? "") || null,
    region: String(formData.get("region") ?? "") || null,
    postalCode: String(formData.get("postalCode") ?? "") || null,
    country: String(formData.get("country") ?? "") || null,
  };

  const existing = await prisma.profile.findFirst();
  if (existing) {
    await prisma.profile.update({ where: { id: existing.id }, data });
  } else {
    await prisma.profile.create({ data });
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export default async function ProfilePage() {
  const profile = await prisma.profile.findFirst();

  return (
    <main>
      <h1>Profile</h1>
      <p>
        This is the single identity used for every automated entry — entering the same giveaway
        under multiple identities is not supported here, by design.
      </p>
      <form action={saveProfile}>
        <label>
          First name
          <input name="firstName" defaultValue={profile?.firstName} required />
        </label>
        <label>
          Last name
          <input name="lastName" defaultValue={profile?.lastName} required />
        </label>
        <label>
          Email
          <input name="email" type="email" defaultValue={profile?.email} required />
        </label>
        <label>
          Phone
          <input name="phone" defaultValue={profile?.phone ?? ""} />
        </label>
        <label>
          Address line 1
          <input name="addressLine1" defaultValue={profile?.addressLine1 ?? ""} />
        </label>
        <label>
          City
          <input name="city" defaultValue={profile?.city ?? ""} />
        </label>
        <label>
          Region/State
          <input name="region" defaultValue={profile?.region ?? ""} />
        </label>
        <label>
          Postal code
          <input name="postalCode" defaultValue={profile?.postalCode ?? ""} />
        </label>
        <label>
          Country
          <input name="country" defaultValue={profile?.country ?? ""} />
        </label>
        <button type="submit">Save</button>
      </form>
    </main>
  );
}
