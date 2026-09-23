import { Injectable, inject } from '@angular/core';
import { SUPABASE_CLIENT } from '../../core/supabase/supabase-client';

export interface ProfileUpdateInput {
  fullName: string;
  phone: string | null;
}

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
}
