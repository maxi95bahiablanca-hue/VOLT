import { supabase } from '../supabase';

const authService = {
  signUp: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  },

  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  signOut: async () => {
    // 🔴 Soltar el token de push de ESTA cuenta antes de cerrar sesión
    //    (auditoría 23-ago): si la fila queda, el próximo que entre en el mismo
    //    teléfono puede recibir avisos de esta cuenta hasta que re-registre. Con
    //    la sesión todavía viva, la RLS propia permite el delete. Best-effort:
    //    un fallo de red no debe trabar el cierre de sesión.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) await supabase.from('push_tokens').delete().eq('user_id', user.id);
    } catch { /* no bloquear el logout */ }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  getSession: async () => {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    return session;
  },

  getUser: async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;
    return user;
  },

  // Borra la cuenta y todos los datos del usuario logueado (App Store 5.1.1(v)).
  // El borrado lo hace `borrar_mi_cuenta()` en la base, que sólo puede tocar al
  // usuario de la sesión que la llama. Después cerramos sesión para que la app
  // vuelva sola al login.
  deleteAccount: async () => {
    const { data, error } = await supabase.rpc('borrar_mi_cuenta');
    if (error) throw error;
    await supabase.auth.signOut().catch(() => {});
    return data;
  },
};

export default authService;
