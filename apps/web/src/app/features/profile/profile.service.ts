import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

export interface ProfileUpdateInput {
  fullName: string;
  phone: string | null;
}

const AVATAR_BUCKET = 'avatars';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly supabase = inject(SUPABASE_CLIENT);

  async updateProfile(id: string, input: ProfileUpdateInput): Promise<void> {
    const { error } = await this.supabase
      .from('profiles')
      .update({ full_name: input.fullName.trim(), phone: input.phone })
      .eq('id', id);
    if (error) throw error;
  }

  /** Sempre sobrescreve `{userId}/avatar.{ext}` — sem acumular arquivos antigos. */
  async uploadAvatar(userId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadError } = await this.supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (uploadError) throw uploadError;

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const bustedUrl = `${publicUrl}?v=${Date.now()}`;

    const { error: updateError } = await this.supabase
      .from('profiles')
      .update({ avatar_url: bustedUrl })
      .eq('id', userId);
    if (updateError) throw updateError;

    return bustedUrl;
  }
}
