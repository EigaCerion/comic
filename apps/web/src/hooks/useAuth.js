import { useMeQuery } from '../api/apiSlice.js';

/**
 * Satu sumber kebenaran soal "siapa yang sedang memakai aplikasi ini".
 *
 * Sengaja membungkus useMeQuery, bukan menyimpan peran di redux: peran yang
 * disimpan di sisi klien bisa basi (akun dinonaktifkan, peran diturunkan) dan
 * yang lebih penting — ia tidak menentukan apa pun. Server tetap memutuskan;
 * hasil di sini hanya dipakai untuk menyembunyikan menu yang toh akan ditolak.
 */
export const useAuth = () => {
  const { data, isLoading, isFetching } = useMeQuery();
  const user = data?.user ?? null;
  const kemampuan = data?.kemampuan ?? [];

  return {
    user,
    sudahMasuk: Boolean(user),
    peran: user?.role ?? null,
    kemampuan,
    bisa: (nama) => kemampuan.includes(nama),
    sedangMemuat: isLoading,
    sedangMenyegarkan: isFetching,
  };
};

export default useAuth;
