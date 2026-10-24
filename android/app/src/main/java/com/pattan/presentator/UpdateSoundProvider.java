package com.pattan.presentator;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.res.AssetFileDescriptor;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.FileNotFoundException;

/** A stable notification-sound URI; no app data or arbitrary files are exposed. */
public final class UpdateSoundProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    private int resource(Uri uri, String mode) throws FileNotFoundException {
        if (getContext() == null || !"/available".equals(uri.getPath()) || !"r".equals(mode)) {
            throw new FileNotFoundException("Unknown update sound");
        }
        int id = getContext().getResources().getIdentifier("update_available_voice", "raw", getContext().getPackageName());
        if (id == 0) throw new FileNotFoundException("Update voice is not packaged");
        return id;
    }

    @Override public AssetFileDescriptor openAssetFile(Uri uri, String mode) throws FileNotFoundException {
        int id = resource(uri, mode);
        return getContext().getResources().openRawResourceFd(id);
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        throw new FileNotFoundException("Use the fixed audio asset");
    }

    @Override public String getType(Uri uri) { return "/available".equals(uri.getPath()) ? "audio/wav" : null; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String order) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
