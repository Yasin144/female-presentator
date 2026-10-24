package com.pattan.presentator;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import java.io.FileNotFoundException;

/** Only nine packaged, non-sensitive voice clips are readable by Android's ringtone service. */
public final class OtMilestoneSoundProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    static int hour(Uri uri) {
        String path = uri.getPath();
        return path != null && path.matches("/[0-8]") ? path.charAt(1) - '0' : -1;
    }
    @Override public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        int h = hour(uri);
        if (getContext() == null || h < 0 || !"r".equals(mode)) throw new FileNotFoundException("Unknown OT voice");
        int id = getContext().getResources().getIdentifier("ot_milestone_" + h, "raw", getContext().getPackageName());
        if (id == 0) throw new FileNotFoundException("OT voice is not packaged");
        return getContext().getResources().openRawResourceFd(id);
    }
    @Override public String getType(Uri uri) { return hour(uri) >= 0 ? "audio/wav" : null; }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri u, String s, String[] a) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { throw new UnsupportedOperationException("Read only"); }
}
